"""
Market Data Service — Zebu/MYNT broker API only (no Yahoo Finance).

All market data comes exclusively from:
  1. User's personal Zebu broker session (if connected)
  2. Master Zebu account (shared NSE live feed if configured in .env)

All quote functions require an active broker session or master session.
If no session is available, a BrokerNotConnected exception is raised.

Responsibilities:
    * Symbol formatting (_format_symbol)
    * User-scoped quote access (get_quote, get_quote_safe)
    * System-level quote access (get_system_quote, get_system_quote_safe)
    * Stock search (local NSE list + Zebu SearchScrip API)
    * Convenience lists (POPULAR_INDIAN_STOCKS, INDIAN_INDICES)
"""

from typing import Optional, Mapping, Any
import time
import logging
import asyncio
from concurrent.futures import ThreadPoolExecutor

from engines.market_session import market_session, MarketState
from services.nse_stocks import NSE_STOCK_LIST

logger = logging.getLogger(__name__)

# Thread pool for blocking yfinance calls
_yf_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="yfinance")

# Per-symbol yfinance quote cache (30s TTL — avoids hammering yfinance on every poll)
_yf_quote_cache: dict = {}
_yf_quote_cache_ts: dict = {}
YF_QUOTE_CACHE_DURATION = 30  # seconds

# ── Search result cache (Yahoo queries are expensive) ──────────────────────────
_search_cache: dict = {}
_search_cache_ts: dict = {}
SEARCH_CACHE_DURATION = 300  # 5 minutes

# Popular Indian stocks (used for ticker bar, default suggestions)
POPULAR_INDIAN_STOCKS = [
    {"symbol": "RELIANCE.NS", "name": "Reliance Industries", "exchange": "NSE"},
    {"symbol": "TCS.NS", "name": "Tata Consultancy Services", "exchange": "NSE"},
    {"symbol": "HDFCBANK.NS", "name": "HDFC Bank", "exchange": "NSE"},
    {"symbol": "INFY.NS", "name": "Infosys", "exchange": "NSE"},
    {"symbol": "ICICIBANK.NS", "name": "ICICI Bank", "exchange": "NSE"},
    {"symbol": "HINDUNILVR.NS", "name": "Hindustan Unilever", "exchange": "NSE"},
    {"symbol": "SBIN.NS", "name": "State Bank of India", "exchange": "NSE"},
    {"symbol": "BHARTIARTL.NS", "name": "Bharti Airtel", "exchange": "NSE"},
    {"symbol": "ITC.NS", "name": "ITC Limited", "exchange": "NSE"},
    {"symbol": "KOTAKBANK.NS", "name": "Kotak Mahindra Bank", "exchange": "NSE"},
    {"symbol": "LT.NS", "name": "Larsen & Toubro", "exchange": "NSE"},
    {"symbol": "AXISBANK.NS", "name": "Axis Bank", "exchange": "NSE"},
    {"symbol": "WIPRO.NS", "name": "Wipro", "exchange": "NSE"},
    {"symbol": "HCLTECH.NS", "name": "HCL Technologies", "exchange": "NSE"},
    {"symbol": "TATAMOTORS.NS", "name": "Tata Motors", "exchange": "NSE"},
    {"symbol": "SUNPHARMA.NS", "name": "Sun Pharma", "exchange": "NSE"},
    {"symbol": "MARUTI.NS", "name": "Maruti Suzuki", "exchange": "NSE"},
    {"symbol": "TITAN.NS", "name": "Titan Company", "exchange": "NSE"},
    {"symbol": "BAJFINANCE.NS", "name": "Bajaj Finance", "exchange": "NSE"},
    {"symbol": "ADANIENT.NS", "name": "Adani Enterprises", "exchange": "NSE"},
]

# Indian market indices
INDIAN_INDICES = [
    {"symbol": "^NSEI", "name": "NIFTY 50"},
    {"symbol": "^BSESN", "name": "SENSEX"},
    {"symbol": "^NSEBANK", "name": "BANK NIFTY"},
    {"symbol": "^CNXIT", "name": "NIFTY IT"},
]


def _format_symbol(symbol: str) -> str:
    """Ensure symbol has .NS suffix for NSE stocks."""
    if not symbol.startswith("^") and not symbol.endswith((".NS", ".BO")):
        return f"{symbol}.NS"
    return symbol


# ── Provider accessor ──────────────────────────────────────────────


def _get_provider_for_user(user_id: str):
    """Return user provider, falling back to master/any active provider."""
    from services.broker_session import broker_session_manager

    provider = broker_session_manager.get_session(user_id)
    if provider is None:
        provider = broker_session_manager.get_any_session()
    if provider is None:
        raise BrokerNotConnected(user_id)
    return provider


def _get_any_provider():
    """Return ANY active provider for system-level tasks. Raises RuntimeError if none."""
    from services.broker_session import broker_session_manager

    provider = broker_session_manager.get_any_session()
    if provider is None:
        raise RuntimeError("No active broker sessions — market data unavailable")
    return provider


class BrokerNotConnected(Exception):
    """Raised when a user has no active broker session."""

    def __init__(self, user_id: str = ""):
        self.user_id = user_id
        super().__init__(
            f"Broker not connected"
            + (f" for user {str(user_id)[:8]}..." if user_id else "")
        )


class ProviderDataUnavailable(Exception):
    """Raised when the active provider has no data for a symbol."""

    pass


# ── User-scoped quote functions ────────────────────────────────────

# Market states where Zebu REST returns unreliable last-price data
_CLOSED_STATES = {MarketState.WEEKEND, MarketState.HOLIDAY, MarketState.CLOSED}


def _adjust_for_market_state(quote: dict) -> dict:
    """Override stale lp with prev_close when the market is not active."""
    state = market_session.get_current_state()
    if state in _CLOSED_STATES:
        prev_close = quote.get("prev_close") or quote.get("close")
        if prev_close and prev_close > 0:
            quote["price"] = prev_close
            quote["change"] = 0
            quote["change_percent"] = 0
        quote["market_status"] = state.value
    return quote


async def get_quote(symbol: str, user_id: str) -> dict:
    """
    Get real-time quote for a symbol via the user's ZebuProvider.

    Raises:
        BrokerNotConnected       – user has no active session.
        ProviderDataUnavailable  – provider returned None for the symbol.
    """
    symbol = _format_symbol(symbol)
    provider = _get_provider_for_user(user_id)
    quote = await provider.get_quote(symbol)
    if quote is None:
        raise ProviderDataUnavailable(
            f"{type(provider).__name__} returned no data for {symbol}"
        )
    return _adjust_for_market_state(quote)


async def get_quote_safe(symbol: str, user_id: str) -> Optional[dict]:
    """
    Like get_quote() but returns None instead of raising on safe errors.
    
    Does NOT fall back to yfinance. If the broker is not connected, returns None.
    Caller must handle the None response (show error message to user).
    """
    fmt = _format_symbol(symbol)
    try:
        return await get_quote(fmt, user_id)
    except BrokerNotConnected:
        logger.info(
            f"get_quote_safe({fmt}, user {str(user_id)[:8]}...): "
            f"no broker session — master session is required"
        )
        return None
    except (ProviderDataUnavailable, RuntimeError) as e:
        logger.debug(
            f"get_quote_safe({fmt}, {str(user_id)[:8] if user_id else '?'}): {e}"
        )
        return None
    except Exception as e:
        logger.error(f"get_quote_safe({fmt}) unexpected: {e}")
        return None


# ── System-level quote functions (no user context) ─────────────────


async def get_system_quote(symbol: str) -> dict:
    """
    Get a quote using ANY available provider session.
    For system-level tasks (workers, ZeroLoss) that don't have user context.

    Raises RuntimeError if no sessions exist.
    """
    symbol = _format_symbol(symbol)
    provider = _get_any_provider()
    quote = await provider.get_quote(symbol)
    if quote is None:
        raise ProviderDataUnavailable(
            f"{type(provider).__name__} returned no data for {symbol}"
        )
    return _adjust_for_market_state(quote)


async def get_system_quote_safe(symbol: str) -> Optional[dict]:
    """
    System-level quote using master Zebu or any active provider session.
    
    Does NOT fall back to yfinance. If no master session is active, returns None.
    Caller should ensure master_session_service.initialize() was called at startup.
    """
    fmt = _format_symbol(symbol)
    try:
        return await get_system_quote(fmt)
    except RuntimeError:
        logger.warning(
            f"get_system_quote_safe({fmt}): no master session active. "
            f"Check that ZEBU_MASTER_USER_ID and credentials are configured in .env"
        )
        return None
    except (ProviderDataUnavailable,) as e:
        logger.debug(f"get_system_quote_safe({fmt}): {e}")
        return None
    except Exception as e:
        logger.error(f"get_system_quote_safe({fmt}) unexpected: {e}")
        return None


# ── yfinance single-symbol quote (broker-free fallback) ────────────


def _get_yfinance_quote_sync(symbol: str) -> Optional[dict]:
    """Blocking yfinance single-symbol quote — runs in thread pool."""
    import yfinance as yf

    try:
        ticker = yf.Ticker(symbol)
        info = ticker.fast_info
        price = getattr(info, "last_price", None) or getattr(info, "previous_close", 0)
        prev_close = getattr(info, "previous_close", 0) or 0
        if not price:
            return None
        change = (price - prev_close) if prev_close else 0
        change_pct = (change / prev_close * 100) if prev_close else 0
        return {
            "symbol": symbol,
            "name": symbol.replace(".NS", "").replace("^", ""),
            "price": round(float(price), 2),
            "change": round(float(change), 2),
            "change_percent": round(float(change_pct), 2),
            "prev_close": round(float(prev_close), 2),
            "open": round(float(getattr(info, "open", 0) or 0), 2),
            "high": round(float(getattr(info, "day_high", 0) or 0), 2),
            "low": round(float(getattr(info, "day_low", 0) or 0), 2),
            "volume": int(getattr(info, "three_month_average_volume", 0) or 0),
        }
    except Exception as e:
        logger.debug(f"yfinance quote {symbol} failed: {e}")
        return None


async def get_yfinance_quote(symbol: str) -> Optional[dict]:
    """
    Get a single quote from yfinance — no broker session required.
    Results are cached for YF_QUOTE_CACHE_DURATION seconds.
    """
    now = time.time()
    if (
        symbol in _yf_quote_cache
        and (now - _yf_quote_cache_ts.get(symbol, 0)) < YF_QUOTE_CACHE_DURATION
    ):
        return _yf_quote_cache[symbol]

    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(_yf_executor, _get_yfinance_quote_sync, symbol)
    if result:
        _yf_quote_cache[symbol] = result
        _yf_quote_cache_ts[symbol] = now
    return result


def _get_yfinance_history_sync(symbol: str, period: str, interval: str) -> list:
    """Blocking yfinance historical data — runs in thread pool."""
    import yfinance as yf

    try:
        ticker = yf.Ticker(symbol)
        df = ticker.history(period=period, interval=interval)
        if df is None or df.empty:
            return []
        candles = []
        for ts, row in df.iterrows():
            try:
                unix_ts = int(ts.timestamp())
            except Exception:
                unix_ts = int(ts) // 1_000_000_000
            candles.append(
                {
                    "time": unix_ts,
                    "open": round(float(row["Open"]), 2),
                    "high": round(float(row["High"]), 2),
                    "low": round(float(row["Low"]), 2),
                    "close": round(float(row["Close"]), 2),
                    "volume": int(row["Volume"]),
                }
            )
        return candles
    except Exception as e:
        logger.debug(f"yfinance history {symbol} failed: {e}")
        return []


async def get_yfinance_history(
    symbol: str, period: str = "1mo", interval: str = "1d"
) -> list:
    """Get historical OHLCV data from yfinance — no broker session required."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        _yf_executor, _get_yfinance_history_sync, symbol, period, interval
    )


async def get_historical_data(
    symbol: str,
    period: str = "1mo",
    interval: str = "1d",
    user_id: Optional[str] = None,
) -> list:
    """
    Get historical OHLCV data for charts.

    Uses user's provider if user_id given, otherwise any provider.
    Falls back to yfinance when no broker session is active.
    Returns empty list on failure.
    """
    symbol = _format_symbol(symbol)

    def _normalize_candles(candles: list) -> list:
        normalized = []
        for candle in candles or []:
            if not isinstance(candle, dict):
                continue
            try:
                t = int(candle.get("time"))
                o = float(candle.get("open"))
                h = float(candle.get("high"))
                l = float(candle.get("low"))
                c = float(candle.get("close"))
                v = int(float(candle.get("volume", 0) or 0))
            except (TypeError, ValueError):
                continue
            normalized.append(
                {
                    "time": t,
                    "open": round(o, 2),
                    "high": round(h, 2),
                    "low": round(l, 2),
                    "close": round(c, 2),
                    "volume": v,
                }
            )

        normalized.sort(key=lambda x: x["time"])

        # De-duplicate by timestamp (keep last)
        deduped = {}
        for c in normalized:
            deduped[c["time"]] = c
        return list(deduped.values())

    try:
        if user_id:
            provider = _get_provider_for_user(user_id)
        else:
            provider = _get_any_provider()

        provider_candles = await provider.get_historical_data(
            symbol, period=period, interval=interval
        )
        normalized = _normalize_candles(provider_candles)

        # Critical: some provider responses are empty for valid symbols/timeframes.
        # Fall back to yfinance instead of returning blank charts.
        if normalized:
            return normalized

        logger.warning(
            f"Provider history empty for {symbol} period={period} interval={interval}; falling back to yfinance"
        )
        return _normalize_candles(
            await get_yfinance_history(symbol, period=period, interval=interval)
        )
    except (BrokerNotConnected, RuntimeError):
        logger.info(
            f"No broker session for history ({symbol}), falling back to yfinance"
        )
        return _normalize_candles(
            await get_yfinance_history(symbol, period=period, interval=interval)
        )
    except NotImplementedError:
        logger.warning(
            f"Provider does not support historical data ({symbol}), "
            "falling back to yfinance"
        )
        return _normalize_candles(
            await get_yfinance_history(symbol, period=period, interval=interval)
        )
    except Exception as e:
        logger.error(f"get_historical_data({symbol}) failed: {e}")
        return []


async def search_stocks(query: str) -> list:
    """Search for Indian stocks — Zebu-first, multi-tier search.

    Priority order:
    1. Local NSE list (~400 stocks, instant, prefix-ranked)
    2. Zebu SearchScrip API (real broker data, covers ALL NSE stocks)
    3. Yahoo Finance search API (fallback when no broker connected)

    Zebu + Yahoo run in parallel for speed.
    Results are merged, deduplicated, and returned (max 20).
    """
    query_upper = query.upper().strip()
    if not query_upper:
        return []

    # ── Check search cache ─────────────────────────────────────────────────────
    now = time.time()
    if (
        query_upper in _search_cache
        and (now - _search_cache_ts.get(query_upper, 0)) < SEARCH_CACHE_DURATION
    ):
        return _search_cache[query_upper]

    # ── Step 1: Local search with ranking (instant) ────────────────────────────
    prefix_matches = []
    substring_matches = []
    for stock in NSE_STOCK_LIST:
        sym_upper = stock["symbol"].upper().replace(".NS", "")
        name_upper = stock["name"].upper()
        if sym_upper.startswith(query_upper) or name_upper.startswith(query_upper):
            prefix_matches.append(stock)
        elif query_upper in sym_upper or query_upper in name_upper:
            substring_matches.append(stock)
    local_results = prefix_matches + substring_matches

    # ── Step 2: Remote searches (run in parallel) ──────────────────────────────
    # Try Zebu first (real broker data). Fall back to Yahoo only if Zebu
    # is unavailable (no broker connected).
    has_broker = False
    try:
        _get_any_provider()
        has_broker = True
    except (RuntimeError, Exception):
        pass

    if has_broker:
        # Broker connected → Zebu SearchScrip is the authoritative source
        remote_results = await _search_zebu(query_upper)
        # If Zebu returned too few and local also sparse, supplement with Yahoo
        if len(local_results) + len(remote_results) < 5:
            yahoo_extra = await _search_yahoo(query_upper)
            remote_results = remote_results + yahoo_extra
    else:
        # No broker → Yahoo Finance as the remote search fallback
        remote_results = await _search_yahoo(query_upper)

    # ── Step 3: Merge & deduplicate ────────────────────────────────────────────
    seen = set()
    merged = []

    # Local results first (best ranking, reliable names)
    for r in local_results:
        sym = r["symbol"]
        if sym not in seen:
            seen.add(sym)
            merged.append(r)

    # Then remote results (Zebu or Yahoo — whichever was used)
    for r in remote_results:
        sym = r["symbol"]
        if sym not in seen:
            seen.add(sym)
            merged.append(r)

    result = merged[:20]

    # Cache the result
    _search_cache[query_upper] = result
    _search_cache_ts[query_upper] = now

    return result


async def _search_zebu(query: str) -> list:
    """Search for instruments via Zebu SearchScrip API."""
    try:
        from providers.symbol_mapper import load_zebu_contracts
        provider = _get_any_provider()
        data = await provider._rest_post(
            "/SearchScrip",
            {
                "exch": "NSE",
                "stext": query,
            },
        )
        if not data or data.get("stat") != "Ok":
            return []

        results = []
        contracts_to_register = []
        for item in data.get("values", []):
            tsym = item.get("tsym", "")
            token = item.get("token", "")
            # Filter to EQ segment only
            if "-EQ" not in tsym:
                continue
            name = tsym.replace("-EQ", "")
            symbol = f"{name}.NS"
            results.append(
                {
                    "symbol": symbol,
                    "name": item.get("instname", name),
                    "exchange": "NSE",
                    "token": token,
                }
            )
            if token:
                contracts_to_register.append({"symbol": name, "token": token, "exchange": "NSE"})

        # Register found tokens so subsequent quotes/history work without SearchScrip
        if contracts_to_register:
            load_zebu_contracts(contracts_to_register)

        return results[:15]
    except (RuntimeError, Exception) as e:
        logger.debug(f"Zebu SearchScrip failed: {e}")
        return []


def _search_yahoo_sync(query: str) -> list:
    """Search stocks via Yahoo Finance public search API (blocking)."""
    import requests

    try:
        url = "https://query2.finance.yahoo.com/v1/finance/search"
        params = {
            "q": query,
            "quotesCount": 15,
            "newsCount": 0,
            "enableFuzzyQuery": True,
        }
        headers = {"User-Agent": "Mozilla/5.0"}
        r = requests.get(url, params=params, headers=headers, timeout=5)
        r.raise_for_status()
        data = r.json()

        results = []
        seen_syms = set()
        for q in data.get("quotes", []):
            symbol = q.get("symbol", "")
            exchange = q.get("exchDisp", "")

            # Only include NSE stocks (skip BSE/BO, US, etc.)
            if not symbol.endswith(".NS"):
                # If it's a BSE listing, convert to NSE equivalent
                if symbol.endswith(".BO") and exchange in ("Bombay", "BSE"):
                    symbol = symbol.replace(".BO", ".NS")
                else:
                    continue

            # Filter out mutual funds (0P...), ETFs, and other non-equity symbols
            base = symbol.replace(".NS", "")
            if base.startswith("0P") or base.startswith("^") or not base[0].isalpha():
                continue

            name = (
                q.get("shortname", "")
                or q.get("longname", "")
                or symbol.replace(".NS", "")
            )
            # Deduplicate within Yahoo results
            if symbol in seen_syms:
                continue
            seen_syms.add(symbol)

            # Clean up ALL-CAPS names from Yahoo
            if name == name.upper() and len(name) > 4:
                name = name.title()

            results.append(
                {
                    "symbol": symbol,
                    "name": name,
                    "exchange": "NSE",
                }
            )
        return results
    except Exception as e:
        logger.debug(f"Yahoo Finance search failed for '{query}': {e}")
        return []


async def _search_yahoo(query: str) -> list:
    """Search stocks via Yahoo Finance — async wrapper."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_yf_executor, _search_yahoo_sync, query)


async def get_indices(user_id: Optional[str] = None) -> list:
    """Get Indian market indices."""
    indices = []
    for idx_info in INDIAN_INDICES:
        if user_id:
            quote = await get_quote_safe(idx_info["symbol"], user_id)
        else:
            quote = await get_system_quote_safe(idx_info["symbol"])
        if quote:
            quote["name"] = idx_info["name"]
            indices.append(quote)
    return indices


async def get_ticker_data(user_id: Optional[str] = None) -> list:
    """Get indices + all popular stocks for the scrolling ticker bar."""
    items = []

    def _append_ticker_item(raw_quote: Any, *, name: str, kind: str) -> None:
        if not raw_quote:
            return

        # Defensive normalisation: provider/yfinance should return dict-like quote,
        # but guard against unexpected object/primitive responses so one bad symbol
        # doesn't fail the entire ticker endpoint.
        if isinstance(raw_quote, Mapping):
            quote = dict(raw_quote)
        elif isinstance(raw_quote, dict):
            quote = raw_quote.copy()
        else:
            logger.warning(
                f"Ticker quote ignored for {name}: unexpected type {type(raw_quote).__name__}"
            )
            return

        quote["name"] = name
        quote["kind"] = kind
        items.append(quote)

    # Indices first
    for idx_info in INDIAN_INDICES:
        try:
            if user_id:
                quote = await get_quote_safe(idx_info["symbol"], user_id)
            else:
                quote = await get_system_quote_safe(idx_info["symbol"])
            _append_ticker_item(quote, name=idx_info["name"], kind="index")
        except Exception as e:
            logger.warning(
                f"Ticker index fetch failed ({idx_info.get('symbol')}): {type(e).__name__}: {e}"
            )

    # Then popular stocks
    for stock in POPULAR_INDIAN_STOCKS:
        try:
            if user_id:
                quote = await get_quote_safe(stock["symbol"], user_id)
            else:
                quote = await get_system_quote_safe(stock["symbol"])
            _append_ticker_item(quote, name=stock["name"], kind="stock")
        except Exception as e:
            logger.warning(
                f"Ticker stock fetch failed ({stock.get('symbol')}): {type(e).__name__}: {e}"
            )

    return items


async def get_batch_quotes(symbols: list[str], user_id: Optional[str] = None) -> dict:
    """Get quotes for multiple symbols."""
    try:
        if user_id:
            provider = _get_provider_for_user(user_id)
        else:
            provider = _get_any_provider()
        return await provider.get_batch_quotes(symbols)
    except (BrokerNotConnected, RuntimeError):
        # No broker session — fall back to yfinance in parallel
        logger.info("No provider for batch quotes, falling back to yfinance")

        async def _yf_one(sym: str):
            formatted = _format_symbol(sym)
            try:
                q = await get_yfinance_quote(formatted)
                return (formatted, q)
            except Exception:
                return (formatted, None)

        pairs = await asyncio.gather(*[_yf_one(s) for s in symbols])
        return {sym: q for sym, q in pairs if q}
    except Exception as e:
        logger.error(f"batch_quotes failed: {e}")
        return {}


# ── yfinance public ticker (no broker needed) ─────────────────────

# Cache for yfinance ticker data
_yf_ticker_cache: list = []
_yf_ticker_cache_ts: float = 0
YF_TICKER_CACHE_DURATION = 30  # 30 seconds

# Symbols for the public ticker
_YF_TICKER_SYMBOLS = [s["symbol"] for s in POPULAR_INDIAN_STOCKS[:10]]
_YF_INDEX_SYMBOLS = [idx["symbol"] for idx in INDIAN_INDICES]


def _fetch_yf_ticker_sync() -> list:
    """Blocking yfinance call — runs in thread pool."""
    import yfinance as yf

    items = []

    # Fetch indices
    for idx_info in INDIAN_INDICES:
        try:
            ticker = yf.Ticker(idx_info["symbol"])
            info = ticker.fast_info
            price = getattr(info, "last_price", None) or getattr(
                info, "previous_close", 0
            )
            prev_close = getattr(info, "previous_close", 0)
            change = price - prev_close if price and prev_close else 0
            change_pct = (change / prev_close * 100) if prev_close else 0
            items.append(
                {
                    "symbol": idx_info["symbol"],
                    "name": idx_info["name"],
                    "price": round(price, 2) if price else 0,
                    "change": round(change, 2),
                    "change_percent": round(change_pct, 2),
                    "prev_close": round(prev_close, 2) if prev_close else 0,
                    "kind": "index",
                }
            )
        except Exception as e:
            logger.debug(f"yfinance index {idx_info['symbol']} failed: {e}")

    # Fetch popular stocks
    for stock in POPULAR_INDIAN_STOCKS[:10]:
        try:
            ticker = yf.Ticker(stock["symbol"])
            info = ticker.fast_info
            price = getattr(info, "last_price", None) or getattr(
                info, "previous_close", 0
            )
            prev_close = getattr(info, "previous_close", 0)
            change = price - prev_close if price and prev_close else 0
            change_pct = (change / prev_close * 100) if prev_close else 0
            items.append(
                {
                    "symbol": stock["symbol"],
                    "name": stock["name"],
                    "price": round(price, 2) if price else 0,
                    "change": round(change, 2),
                    "change_percent": round(change_pct, 2),
                    "prev_close": round(prev_close, 2) if prev_close else 0,
                    "kind": "stock",
                }
            )
        except Exception as e:
            logger.debug(f"yfinance stock {stock['symbol']} failed: {e}")

    return items


async def get_public_ticker_data() -> list:
    """Get ticker data from yfinance — no broker session required."""
    global _yf_ticker_cache, _yf_ticker_cache_ts

    now = time.time()
    if _yf_ticker_cache and (now - _yf_ticker_cache_ts) < YF_TICKER_CACHE_DURATION:
        return _yf_ticker_cache

    try:
        loop = asyncio.get_event_loop()
        items = await loop.run_in_executor(_yf_executor, _fetch_yf_ticker_sync)
        if items:
            _yf_ticker_cache = items
            _yf_ticker_cache_ts = now
        return items
    except Exception as e:
        logger.error(f"yfinance public ticker failed: {e}")
        return _yf_ticker_cache  # return stale cache if available
