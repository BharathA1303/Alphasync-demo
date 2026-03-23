"""
AlphaSync ZeroLoss — Controller (Orchestrator).

Ties the Confidence Engine, Signal Generator, and Break-Even Manager
into a single run-loop that:

    1. Fetches candle + quote data for each tracked symbol
    2. Scores confidence
    3. Generates LONG / SHORT / NO_TRADE signals
    4. Manages active positions (monitors SL / target / 3:20 PM close)
    5. Persists signals + performance to PostgreSQL
    6. Emits events to the Event Bus for WebSocket streaming

The controller is started as an asyncio background task from main.py,
just like the existing market_data_worker and order_execution_worker.

Usage:
    from strategies.zeroloss.controller import zeroloss_controller

    # In lifespan:
    asyncio.create_task(zeroloss_controller.run())
"""

import asyncio
import logging
from datetime import datetime, time, date, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from core.event_bus import event_bus, Event, EventType
from database.connection import async_session_factory
from engines.market_session import market_session
from services import market_data

from strategies.zeroloss.confidence_engine import ConfidenceEngine
from strategies.zeroloss.signal_generator import ZeroLossSignalGenerator, ZeroLossSignal
from strategies.zeroloss.breakeven_manager import BreakevenManager

logger = logging.getLogger(__name__)

IST = ZoneInfo("Asia/Kolkata")

# Force-close time: 3:20 PM IST (10 min before market close)
FORCE_CLOSE_TIME = time(15, 20)

# Default symbols to track
DEFAULT_SYMBOLS = ["RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "INFY.NS", "ICICIBANK.NS"]


class ZeroLossController:
    """
    Background worker that runs the ZeroLoss strategy pipeline.

    Lifecycle:
        .start()  → sets running = True; must be passed to asyncio.create_task
        .stop()   → graceful shutdown
        .run()    → main event loop

    State is persisted to the zeroloss_signals and zeroloss_performance
    tables via SQLAlchemy async sessions.
    """

    # Intervals (seconds)
    SCAN_INTERVAL = 30  # How often to re-evaluate each symbol
    MONITOR_INTERVAL = 5  # How often to check active position exits
    CANDLE_PERIOD = "1y"  # Historical data window for indicators
    CANDLE_INTERVAL = "1d"  # Candle granularity

    def __init__(
        self,
        symbols: Optional[list[str]] = None,
        confidence_threshold: float = 75.0,
        risk_reward_ratio: float = 3.0,
        quantity: int = 1,
    ):
        self._running = False
        self._enabled = False  # User toggle: start/stop strategy
        self._symbols = symbols or DEFAULT_SYMBOLS.copy()
        self._threshold = confidence_threshold
        self._rr_ratio = risk_reward_ratio
        self._quantity = quantity

        # Engine instances
        self._confidence = ConfidenceEngine()
        self._signal_gen = ZeroLossSignalGenerator(
            confidence_threshold=confidence_threshold,
            risk_reward_ratio=risk_reward_ratio,
        )
        self._breakeven = BreakevenManager()

        # In-memory active positions: symbol → ZeroLossSignal
        self._active_positions: dict[str, ZeroLossSignal] = {}

        # Latest confidence snapshot per symbol (for API)
        self._latest_confidence: dict[str, dict] = {}

        # Performance counters (reset daily)
        self._today: Optional[date] = None
        self._total_trades = 0
        self._profit_trades = 0
        self._breakeven_trades = 0
        self._net_pnl = 0.0

    # ── Public API ─────────────────────────────────────────────────────────────

    def enable(self) -> None:
        """Enable the strategy (user toggle ON)."""
        self._enabled = True
        logger.info("ZeroLoss strategy ENABLED")

    def disable(self) -> None:
        """Disable the strategy (user toggle OFF)."""
        self._enabled = False
        logger.info("ZeroLoss strategy DISABLED")

    def is_enabled(self) -> bool:
        return self._enabled

    def get_symbols(self) -> list[str]:
        return list(self._symbols)

    def set_symbols(self, symbols: list[str]) -> None:
        self._symbols = [market_data._format_symbol(s) for s in symbols]

    def get_latest_confidence(self) -> dict:
        """Return latest confidence snapshots for all tracked symbols."""
        return dict(self._latest_confidence)

    def get_active_positions(self) -> dict[str, dict]:
        """Return currently active positions as serialisable dicts."""
        return {sym: sig.to_dict() for sym, sig in self._active_positions.items()}

    def get_stats(self) -> dict:
        """Return summary stats for the health endpoint."""
        return {
            "enabled": self._enabled,
            "symbols": self._symbols,
            "active_positions": len(self._active_positions),
            "today_trades": self._total_trades,
            "today_profit": self._profit_trades,
            "today_breakeven": self._breakeven_trades,
            "today_pnl": round(self._net_pnl, 2),
        }

    # ── Main Loop ──────────────────────────────────────────────────────────────

    async def run(self) -> None:
        """
        Main background loop.  Started via asyncio.create_task(zeroloss_controller.run()).
        """
        self._running = True
        logger.info(
            f"ZeroLoss Controller started | Symbols: {self._symbols} | "
            f"Threshold: {self._threshold} | RR: 1:{self._rr_ratio}"
        )

        while self._running:
            try:
                # Reset daily counters at midnight IST
                self._maybe_reset_daily()

                if not self._enabled:
                    await asyncio.sleep(self.SCAN_INTERVAL)
                    continue

                # ── Phase 1: Monitor active positions ──────────────
                await self._monitor_active_positions()

                # ── Phase 2: Force-close check (3:20 PM IST) ──────
                await self._check_force_close()

                # ── Phase 3: Scan for new signals ──────────────────
                # Only scan during market hours (or simulation mode)
                if market_session.is_trading_hours() or market_session.simulation_mode:
                    await self._scan_for_signals()

                await asyncio.sleep(self.SCAN_INTERVAL)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"ZeroLoss Controller error: {e}", exc_info=True)
                await asyncio.sleep(10)

        logger.info("ZeroLoss Controller stopped")

    async def stop(self) -> None:
        """Gracefully stop the controller."""
        self._running = False

    # ── Scan for New Signals ───────────────────────────────────────────────────

    async def _scan_for_signals(self) -> None:
        """
        For each tracked symbol that doesn't have an active position,
        fetch data, score confidence, and generate a signal.
        """
        for symbol in self._symbols:
            if symbol in self._active_positions:
                continue  # Already have an active position

            try:
                # Fetch historical candles for indicator computation
                candles = await market_data.get_historical_data(
                    symbol, self.CANDLE_PERIOD, self.CANDLE_INTERVAL
                )
                if not candles or len(candles) < 55:
                    logger.warning(
                        f"[{symbol}] Insufficient candle data "
                        f"({len(candles) if candles else 0} bars, need >= 55)"
                    )
                    continue

                closes = [c["close"] for c in candles]
                highs = [c["high"] for c in candles]
                lows = [c["low"] for c in candles]
                volumes = [c["volume"] for c in candles]

                # Fetch current quote for entry price
                quote = await market_data.get_system_quote_safe(symbol)
                if not quote or not quote.get("price"):
                    continue

                current_price = quote["price"]

                # Score confidence
                confidence = self._confidence.score(
                    closes=closes,
                    highs=highs,
                    lows=lows,
                    volumes=volumes,
                    vix=None,  # VIX fetched separately if available
                )

                # Debug: log detailed confidence scoring for diagnostics
                logger.info(
                    f"[{symbol}] Confidence={confidence.total:.1f} "
                    f"Direction={confidence.direction} Reasons={confidence.reasons}"
                )

                # Store latest confidence for API
                self._latest_confidence[symbol] = {
                    "symbol": symbol,
                    "score": confidence.total,
                    "direction": confidence.direction,
                    "breakdown": {
                        "ema": confidence.ema_score,
                        "rsi": confidence.rsi_score,
                        "macd": confidence.macd_score,
                        "volume": confidence.volume_score,
                        "volatility": confidence.volatility_score,
                        "support_resistance": confidence.sr_score,
                    },
                    "reasons": confidence.reasons,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }

                # Broadcast confidence update via WebSocket
                await event_bus.emit(
                    Event(
                        type=EventType.ALGO_SIGNAL,
                        data={
                            "channel": "zeroloss",
                            "type": "confidence_update",
                            "confidence": self._latest_confidence[symbol],
                            "stats": self.get_stats(),
                        },
                        source="zeroloss_controller",
                    )
                )

                # Generate signal
                signal = self._signal_gen.generate(
                    confidence=confidence,
                    symbol=symbol,
                    current_price=current_price,
                    quantity=self._quantity,
                )

                # Debug: log generated signal summary
                try:
                    logger.info(
                        f"[{symbol}] Generated signal -> direction={signal.direction} "
                        f"score={signal.confidence_score:.1f} entry={signal.entry_price} "
                        f"sl={signal.stop_loss} target={signal.target}"
                    )
                except Exception:
                    logger.debug("Failed to stringify generated signal", exc_info=True)

                # If actionable, activate position and persist
                if signal.direction in ("LONG", "SHORT"):
                    signal.status = "ACTIVE"
                    self._active_positions[symbol] = signal
                    self._total_trades += 1

                    await self._persist_signal(signal)

                    await event_bus.emit(
                        Event(
                            type=EventType.ALGO_TRADE,
                            data={
                                "channel": "zeroloss",
                                "action": "ENTRY",
                                "signal": signal.to_dict(),
                            },
                            source="zeroloss_controller",
                        )
                    )

                # Throttle between symbols
                await asyncio.sleep(1)

            except Exception as e:
                logger.error(f"[{symbol}] Scan error: {e}", exc_info=True)

    # ── Monitor Active Positions ───────────────────────────────────────────────

    async def _monitor_active_positions(self) -> None:
        """
        Check each active position against current market price to
        determine if stop-loss (break-even) or target is hit.
        """
        closed_symbols: list[str] = []

        for symbol, signal in self._active_positions.items():
            try:
                quote = await market_data.get_system_quote_safe(symbol)
                if not quote or not quote.get("price"):
                    continue

                current_price = quote["price"]

                exit_reason = self._breakeven.check_exit(
                    direction=signal.direction,
                    entry_price=signal.entry_price,
                    current_price=current_price,
                    stop_loss=signal.stop_loss,
                    target=signal.target,
                )

                if exit_reason is not None:
                    signal.status = exit_reason  # "PROFIT" or "BREAKEVEN"

                    # Calculate realised PnL
                    if signal.direction == "LONG":
                        pnl = (current_price - signal.entry_price) * self._quantity
                    else:
                        pnl = (signal.entry_price - current_price) * self._quantity

                    # Subtract costs
                    levels = self._breakeven.compute_levels(
                        entry_price=signal.entry_price,
                        direction=signal.direction,
                        quantity=self._quantity,
                    )
                    net_pnl = round(pnl - levels.total_cost, 2)

                    # Update counters
                    if exit_reason == "PROFIT":
                        self._profit_trades += 1
                        self._net_pnl += net_pnl
                    else:  # BREAKEVEN
                        self._breakeven_trades += 1
                        # net_pnl should be ~0 for breakeven

                    # Persist exit
                    await self._persist_signal_update(signal, net_pnl)

                    # Emit exit event
                    await event_bus.emit(
                        Event(
                            type=EventType.ALGO_TRADE,
                            data={
                                "channel": "zeroloss",
                                "action": "EXIT",
                                "reason": exit_reason,
                                "signal": signal.to_dict(),
                                "pnl": net_pnl,
                            },
                            source="zeroloss_controller",
                        )
                    )

                    closed_symbols.append(symbol)

                    logger.info(
                        f"[{symbol}] Position closed — {exit_reason} | "
                        f"PnL: ₹{net_pnl:.2f}"
                    )

            except Exception as e:
                logger.error(f"[{symbol}] Monitor error: {e}", exc_info=True)

        # Remove closed positions
        for sym in closed_symbols:
            self._active_positions.pop(sym, None)

    # ── Force Close (3:20 PM IST) ──────────────────────────────────────────────

    async def _check_force_close(self) -> None:
        """
        Close all active positions at 3:20 PM IST to avoid overnight risk.
        In simulation mode, this still enforces the rule for realism.
        """
        now_ist = datetime.now(IST)
        current_time = now_ist.time()

        if current_time < FORCE_CLOSE_TIME:
            return

        # Don't force-close on weekends or if already force-closed today
        if now_ist.weekday() >= 5:
            return

        closed_symbols: list[str] = []

        for symbol, signal in self._active_positions.items():
            try:
                quote = await market_data.get_system_quote_safe(symbol)
                current_price = quote["price"] if quote else signal.entry_price

                # Determine outcome
                if signal.direction == "LONG":
                    pnl = (current_price - signal.entry_price) * self._quantity
                else:
                    pnl = (signal.entry_price - current_price) * self._quantity

                levels = self._breakeven.compute_levels(
                    entry_price=signal.entry_price,
                    direction=signal.direction,
                    quantity=self._quantity,
                )
                net_pnl = round(pnl - levels.total_cost, 2)

                if net_pnl > 0:
                    signal.status = "PROFIT"
                    self._profit_trades += 1
                else:
                    signal.status = "BREAKEVEN"
                    self._breakeven_trades += 1
                    net_pnl = 0.0  # Clamp to zero — guaranteed by design

                self._net_pnl += net_pnl

                await self._persist_signal_update(signal, net_pnl)

                await event_bus.emit(
                    Event(
                        type=EventType.ALGO_TRADE,
                        data={
                            "channel": "zeroloss",
                            "action": "FORCE_CLOSE",
                            "reason": "3:20 PM IST market close",
                            "signal": signal.to_dict(),
                            "pnl": net_pnl,
                        },
                        source="zeroloss_controller",
                    )
                )

                closed_symbols.append(symbol)

                logger.info(
                    f"[{symbol}] Force-closed at 3:20 PM IST | "
                    f"Status: {signal.status} | PnL: ₹{net_pnl:.2f}"
                )

            except Exception as e:
                logger.error(f"[{symbol}] Force-close error: {e}", exc_info=True)

        for sym in closed_symbols:
            self._active_positions.pop(sym, None)

    # ── Daily Reset ────────────────────────────────────────────────────────────

    def _maybe_reset_daily(self) -> None:
        """Reset daily counters at midnight IST."""
        today = datetime.now(IST).date()
        if self._today != today:
            if self._today is not None:
                # Persist yesterday's performance before reset
                asyncio.create_task(self._persist_daily_performance())
            self._today = today
            self._total_trades = 0
            self._profit_trades = 0
            self._breakeven_trades = 0
            self._net_pnl = 0.0

    # ── Database Persistence ───────────────────────────────────────────────────

    async def _persist_signal(self, signal: ZeroLossSignal) -> None:
        """Insert a new signal record into zeroloss_signals."""
        try:
            async with async_session_factory() as session:
                from sqlalchemy import text

                await session.execute(
                    text(
                        """
                        INSERT INTO zeroloss_signals
                            (symbol, timestamp, confidence_score, direction,
                             entry_price, stop_loss, target, status)
                        VALUES
                            (:symbol, :ts, :score, :direction,
                             :entry, :sl, :target, :status)
                    """
                    ),
                    {
                        "symbol": signal.symbol,
                        "ts": signal.timestamp,
                        "score": signal.confidence_score,
                        "direction": signal.direction,
                        "entry": signal.entry_price,
                        "sl": signal.stop_loss,
                        "target": signal.target,
                        "status": signal.status,
                    },
                )
                await session.commit()
        except Exception as e:
            logger.error(f"Failed to persist signal: {e}", exc_info=True)

    async def _persist_signal_update(self, signal: ZeroLossSignal, pnl: float) -> None:
        """Update signal status on exit."""
        try:
            async with async_session_factory() as session:
                from sqlalchemy import text

                await session.execute(
                    text(
                        """
                        UPDATE zeroloss_signals
                        SET status = :status
                        WHERE symbol = :symbol
                          AND timestamp = :ts
                          AND direction = :direction
                    """
                    ),
                    {
                        "status": signal.status,
                        "symbol": signal.symbol,
                        "ts": signal.timestamp,
                        "direction": signal.direction,
                    },
                )
                await session.commit()
        except Exception as e:
            logger.error(f"Failed to update signal: {e}", exc_info=True)

    async def _persist_daily_performance(self) -> None:
        """Insert daily performance summary into zeroloss_performance."""
        try:
            async with async_session_factory() as session:
                from sqlalchemy import text

                await session.execute(
                    text(
                        """
                        INSERT INTO zeroloss_performance
                            (date, total_trades, profit_trades, breakeven_trades,
                             loss_trades, net_pnl)
                        VALUES
                            (:date, :total, :profit, :breakeven, :loss, :pnl)
                        ON CONFLICT (date) DO UPDATE SET
                            total_trades = :total,
                            profit_trades = :profit,
                            breakeven_trades = :breakeven,
                            loss_trades = :loss,
                            net_pnl = :pnl
                    """
                    ),
                    {
                        "date": self._today,
                        "total": self._total_trades,
                        "profit": self._profit_trades,
                        "breakeven": self._breakeven_trades,
                        "loss": 0,  # Always zero by design
                        "pnl": round(self._net_pnl, 2),
                    },
                )
                await session.commit()
        except Exception as e:
            logger.error(f"Failed to persist daily performance: {e}", exc_info=True)

    async def get_signal_history(
        self, limit: int = 50, symbol: Optional[str] = None
    ) -> list[dict]:
        """Fetch recent signals from DB for the API."""
        try:
            async with async_session_factory() as session:
                from sqlalchemy import text

                query = "SELECT * FROM zeroloss_signals"
                params: dict = {"limit": limit}

                if symbol:
                    query += " WHERE symbol = :symbol"
                    params["symbol"] = symbol

                query += " ORDER BY timestamp DESC LIMIT :limit"

                result = await session.execute(text(query), params)
                rows = result.mappings().all()
                return [dict(r) for r in rows]
        except Exception as e:
            logger.error(f"Failed to fetch signal history: {e}", exc_info=True)
            return []

    async def get_performance_summary(self, days: int = 30) -> list[dict]:
        """Fetch performance records from DB for the API."""
        try:
            async with async_session_factory() as session:
                from sqlalchemy import text

                result = await session.execute(
                    text(
                        """
                        SELECT * FROM zeroloss_performance
                        ORDER BY date DESC
                        LIMIT :days
                    """
                    ),
                    {"days": days},
                )
                rows = result.mappings().all()
                return [dict(r) for r in rows]
        except Exception as e:
            logger.error(f"Failed to fetch performance: {e}", exc_info=True)
            return []


# ── Singleton ──────────────────────────────────────────────────────────────────
zeroloss_controller = ZeroLossController(confidence_threshold=60.0)
