"""
Algo Strategy Worker — Background algo trading runtime.

Periodically evaluates all ACTIVE strategies: fetches historical data,
computes indicators, generates signals, validates through risk engine,
and places orders automatically.

This worker brings the algo engine to life — it was previously CRUD-only.
"""

import asyncio
import logging
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from core.event_bus import event_bus, Event, EventType
from engines.market_session import market_session
from engines.signals import signal_generator
from engines.risk_engine import risk_engine
from database.connection import async_session_factory
from models.algo import AlgoStrategy, AlgoTrade, AlgoLog
from services import market_data
from services.trading_engine import place_order

logger = logging.getLogger(__name__)


class AlgoStrategyWorker:
    """
    Schedules and executes algorithmic trading strategies.

    Lifecycle per strategy per cycle:
    1. Fetch 60-day historical data for the strategy's symbol
    2. Compute indicators via IndicatorEngine (called by SignalGenerator)
    3. Generate BUY/SELL/HOLD signal
    4. If actionable signal: run Risk Engine pre-checks
    5. If risk passes: place order via TradingEngine
    6. Log everything to AlgoLog table
    """

    EVAL_INTERVAL = 30  # seconds between strategy evaluation cycles

    def __init__(self):
        self._running = False
        self._stats = {"cycles": 0, "signals": 0, "trades": 0, "errors": 0}

    async def run(self) -> None:
        """Main loop — started via asyncio.create_task in lifespan."""
        self._running = True
        logger.info("Algo Strategy Worker started")

        while self._running:
            try:
                if not market_session.can_run_algo():
                    await asyncio.sleep(60)
                    continue

                await self._evaluate_all_strategies()
                self._stats["cycles"] += 1
                await asyncio.sleep(self.EVAL_INTERVAL)

            except asyncio.CancelledError:
                break
            except Exception as e:
                self._stats["errors"] += 1
                logger.error(f"Algo Strategy Worker error: {e}", exc_info=True)
                await asyncio.sleep(15)

        logger.info("Algo Strategy Worker stopped")

    async def _evaluate_all_strategies(self) -> None:
        """Fetch all active strategies and evaluate each."""
        async with async_session_factory() as db:
            try:
                result = await db.execute(
                    select(AlgoStrategy).where(AlgoStrategy.is_active == True)
                )
                strategies = result.scalars().all()

                if not strategies:
                    return

                logger.debug(f"Evaluating {len(strategies)} active strategies")

                for strategy in strategies:
                    try:
                        await self._evaluate_strategy(db, strategy)
                    except Exception as e:
                        self._stats["errors"] += 1
                        logger.error(
                            f"Strategy evaluation failed [{strategy.id}]: {e}",
                            exc_info=True,
                        )
                        # Log the error
                        db.add(
                            AlgoLog(
                                strategy_id=strategy.id,
                                level="ERROR",
                                message=str(e)[:500],
                            )
                        )

                await db.commit()

            except Exception as e:
                await db.rollback()
                raise

    async def _evaluate_strategy(
        self, db: AsyncSession, strategy: AlgoStrategy
    ) -> None:
        """Evaluate a single strategy and potentially place an order."""

        # ── Step 1: Fetch historical data ───────────────────────────
        candles = await market_data.get_historical_data(
            strategy.symbol,
            period="3mo",
            interval="1d",
            user_id=str(strategy.user_id),
        )

        if not candles or len(candles) < 30:
            db.add(
                AlgoLog(
                    strategy_id=strategy.id,
                    level="WARNING",
                    message=f"Insufficient historical data ({len(candles) if candles else 0} candles)",
                )
            )
            return

        closes = [c["close"] for c in candles if "close" in c]
        highs = [c.get("high", c["close"]) for c in candles]
        lows = [c.get("low", c["close"]) for c in candles]
        volumes = [c.get("volume", 0) for c in candles]

        # ── Step 2 & 3: Compute indicators + generate signal ──────
        parameters = (
            strategy.parameters if isinstance(strategy.parameters, dict) else {}
        )
        signal = signal_generator.evaluate(
            strategy_type=strategy.strategy_type,
            closes=closes,
            highs=highs,
            lows=lows,
            volumes=volumes,
            parameters=parameters,
        )

        self._stats["signals"] += 1

        # Log every signal (even HOLD for audit trail)
        db.add(
            AlgoLog(
                strategy_id=strategy.id,
                level="TRADE" if signal.action != "HOLD" else "INFO",
                message=f"[{signal.action}] {signal.reason}",
                data=signal.indicator_values,
            )
        )

        if signal.action == "HOLD":
            return

        # ── Step 4: Risk pre-check ────────────────────────────────
        quote = await market_data.get_quote_safe(strategy.symbol, str(strategy.user_id))
        if not quote or "price" not in quote:
            return

        current_price = quote["price"]
        # Default quantity from strategy params (or 1)
        quantity = parameters.get("quantity", 1)

        risk_result = await risk_engine.validate_order(
            db=db,
            user_id=str(strategy.user_id),
            symbol=strategy.symbol,
            side=signal.action,
            order_type="MARKET",
            quantity=quantity,
            price=current_price,
            is_algo=True,
        )

        if not risk_result.passed:
            db.add(
                AlgoLog(
                    strategy_id=strategy.id,
                    level="WARNING",
                    message=f"Risk rejected {signal.action}: {risk_result.reason}",
                    data={
                        "check": risk_result.check_name,
                        "details": risk_result.details,
                    },
                )
            )

            await event_bus.emit(
                Event(
                    type=EventType.ALGO_ERROR,
                    data={
                        "strategy_id": str(strategy.id),
                        "reason": risk_result.reason,
                    },
                    user_id=str(strategy.user_id),
                    source="algo_worker",
                )
            )
            return

        # ── Step 5: Place the order ───────────────────────────────
        try:
            order_result = await place_order(
                db=db,
                user_id=str(strategy.user_id),
                symbol=strategy.symbol,
                side=signal.action,
                order_type="MARKET",
                quantity=quantity,
            )

            if order_result.get("success"):
                self._stats["trades"] += 1

                # Record algo trade
                db.add(
                    AlgoTrade(
                        strategy_id=strategy.id,
                        user_id=str(strategy.user_id),
                        symbol=strategy.symbol,
                        side=signal.action,
                        quantity=quantity,
                        price=current_price,
                        signal=signal.reason[:50] if signal.reason else None,
                    )
                )

                # Update strategy stats
                strategy.total_trades = (strategy.total_trades or 0) + 1

                db.add(
                    AlgoLog(
                        strategy_id=strategy.id,
                        level="TRADE",
                        message=(
                            f"{signal.action} {quantity}x {strategy.symbol} "
                            f"@ ₹{current_price:.2f} | Reason: {signal.reason}"
                        ),
                    )
                )

                await event_bus.emit(
                    Event(
                        type=EventType.ALGO_TRADE,
                        data={
                            "strategy_id": str(strategy.id),
                            "symbol": strategy.symbol,
                            "side": signal.action,
                            "quantity": quantity,
                            "price": current_price,
                            "reason": signal.reason,
                        },
                        user_id=str(strategy.user_id),
                        source="algo_worker",
                    )
                )
            else:
                db.add(
                    AlgoLog(
                        strategy_id=strategy.id,
                        level="ERROR",
                        message=f"Order placement failed: {order_result.get('error', 'Unknown error')}",
                    )
                )

        except Exception as e:
            db.add(
                AlgoLog(
                    strategy_id=strategy.id,
                    level="ERROR",
                    message=f"Order placement error: {str(e)[:200]}",
                )
            )
            raise

    async def stop(self) -> None:
        self._running = False

    def get_stats(self) -> dict:
        return self._stats.copy()


# ── Singleton ──────────────────────────────────────────────────────
algo_strategy_worker = AlgoStrategyWorker()
