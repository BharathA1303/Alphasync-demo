"""
Market Data Worker — Background price streaming.

Reads prices from any available ZebuProvider session and emits
PRICE_UPDATED events via the EventBus. Downstream consumers
(WebSocket manager, Order Worker, ZeroLoss) subscribe to these events.

Per-user architecture:
    - No global provider. Worker uses broker_session_manager.get_any_session().
    - If no sessions exist, the worker idles (no data to stream).
    - When a user connects their broker, a session appears and the
      worker resumes streaming.
"""

import asyncio
import logging

from core.event_bus import event_bus, Event, EventType
from engines.market_session import market_session, MarketState

logger = logging.getLogger(__name__)


class MarketDataWorker:
    """
    Fetches live prices from any available broker session and emits events.

    Interval adapts to market state:
    - Open:   3 seconds between sweeps
    - Closed: 60 seconds (reduced frequency)
    """

    ACTIVE_INTERVAL = 3  # seconds between full sweeps
    IDLE_INTERVAL = 60  # seconds when market closed
    NO_SESSION_INTERVAL = 10  # seconds when no broker sessions
    SYMBOL_DELAY = 0.3  # seconds between individual symbol fetches

    def __init__(self):
        self._running = False
        self._subscribed_symbols: set[str] = set()
        self._stats = {"sweeps": 0, "emits": 0, "no_session_waits": 0}

    def add_symbol(self, symbol: str) -> None:
        """Add a symbol to the streaming set."""
        self._subscribed_symbols.add(symbol)

    def remove_symbol(self, symbol: str) -> None:
        """Remove a symbol from the streaming set."""
        self._subscribed_symbols.discard(symbol)

    def get_stats(self) -> dict:
        """Return worker stats."""
        return {
            **self._stats,
            "symbols": list(self._subscribed_symbols),
            "symbol_count": len(self._subscribed_symbols),
        }

    async def run(self) -> None:
        """Main loop — started via asyncio.create_task in lifespan."""
        self._running = True
        logger.info("Market Data Worker started (per-user architecture)")

        # Auto-subscribe popular symbols
        from services.market_data import POPULAR_INDIAN_STOCKS, INDIAN_INDICES

        for s in POPULAR_INDIAN_STOCKS:
            self._subscribed_symbols.add(s["symbol"])
        for i in INDIAN_INDICES:
            self._subscribed_symbols.add(i["symbol"])

        while self._running:
            try:
                # CHECK MARKET STATE FIRST — if closed, skip all data generation
                actual_state = market_session.get_current_state()
                market_closed = actual_state in (
                    MarketState.WEEKEND,
                    MarketState.HOLIDAY,
                    MarketState.CLOSED,
                )

                if market_closed:
                    # Market is closed — STOP ALL DATA GENERATION
                    # (matching Zerodha/broker behavior)
                    # Users see only cached previous close data from Redis
                    # No new fetches, no new events emitted
                    logger.debug(
                        f"Market closed ({actual_state.value}) — skipping data generation, "
                        "serving cached previous close data only"
                    )
                    await asyncio.sleep(self.IDLE_INTERVAL)
                    continue

                # Get any available provider session
                from services.broker_session import broker_session_manager

                provider = broker_session_manager.get_any_session()

                if provider is None:
                    # No broker sessions — use yfinance as fallback for demo mode
                    self._stats["no_session_waits"] += 1
                    if self._stats["no_session_waits"] % 30 == 1:
                        logger.debug(
                            "MarketDataWorker: No broker sessions, "
                            "streaming via yfinance fallback"
                        )
                    # Emit yfinance prices every 3 cycles (~30s, matches cache TTL)
                    if self._stats["no_session_waits"] % 3 == 1:
                        try:
                            from services.market_data import get_public_ticker_data

                            items = await get_public_ticker_data()
                            for item in items:
                                symbol = item.get("symbol")
                                if symbol:
                                    self._stats["emits"] += 1

                                    # Also cache yfinance fallback data in Redis
                                    try:
                                        from cache.redis_client import set_price
                                        await set_price(symbol, item)
                                    except Exception as _re:
                                        logger.debug(f"Redis yf write skipped for {symbol}: {_re}")

                                    await event_bus.emit(
                                        Event(
                                            type=EventType.PRICE_UPDATED,
                                            data={"symbol": symbol, "quote": item},
                                            source="market_data_worker_yf",
                                        )
                                    )
                        except Exception as e:
                            logger.debug(f"yfinance fallback emit failed: {e}")
                    await asyncio.sleep(self.NO_SESSION_INTERVAL)
                    continue

                # Sweep all subscribed symbols
                symbols = list(self._subscribed_symbols)

                if symbols:
                    for symbol in symbols:
                        if not self._running:
                            break

                        quote = await provider.get_quote(symbol)
                        if quote:
                            self._stats["emits"] += 1

                            # Write to Redis cache so all API endpoints can serve this
                            # without hitting Zebu again — this is the shared data hub
                            try:
                                from cache.redis_client import set_price
                                await set_price(symbol, quote)
                            except Exception as _re:
                                logger.debug(f"Redis write skipped for {symbol}: {_re}")

                            await event_bus.emit(
                                Event(
                                    type=EventType.PRICE_UPDATED,
                                    data={
                                        "symbol": symbol,
                                        "quote": quote,
                                    },
                                    source="market_data_worker",
                                )
                            )

                        await asyncio.sleep(self.SYMBOL_DELAY)

                self._stats["sweeps"] += 1

                # After each full sweep, refresh the ticker cache in Redis
                # so all API calls to /ticker immediately get fresh data
                try:
                    from cache.redis_client import set_ticker, set_indices, get_quote as redis_get_quote
                    from services.market_data import POPULAR_INDIAN_STOCKS, INDIAN_INDICES

                    ticker_items = []
                    for idx in INDIAN_INDICES:
                        q = await redis_get_quote(idx["symbol"])
                        if q:
                            q["name"] = idx["name"]
                            q["kind"] = "index"
                            ticker_items.append(q)
                    for stock in POPULAR_INDIAN_STOCKS:
                        q = await redis_get_quote(stock["symbol"])
                        if q:
                            q["name"] = stock["name"]
                            q["kind"] = "stock"
                            ticker_items.append(q)
                    if ticker_items:
                        await set_ticker(ticker_items)
                        await set_indices([i for i in ticker_items if i.get("kind") == "index"])
                except Exception as _te:
                    logger.debug(f"Ticker cache refresh failed: {_te}")

                # Market is open — poll at active interval (3s)
                # (Market closed state is already handled at top of loop with early continue)
                await asyncio.sleep(self.ACTIVE_INTERVAL)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Market Data Worker error: {e}", exc_info=True)
                await asyncio.sleep(5)

        logger.info("Market Data Worker stopped")

    async def stop(self) -> None:
        """Gracefully stop the worker."""
        self._running = False


# ── Singleton ──────────────────────────────────────────────────────
market_data_worker = MarketDataWorker()
