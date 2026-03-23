import logging
from fastapi import APIRouter, Query, Depends, HTTPException
from services import market_data
from routes.auth import get_current_user
from models.user import User
from engines.market_session import market_session

router = APIRouter(prefix="/api/market", tags=["Market Data"])
logger = logging.getLogger(__name__)


@router.get("/session")
async def get_market_session():
    """Market session info — public, no auth required."""
    return market_session.get_session_info()


@router.get("/quote/{symbol}")
async def get_quote(symbol: str, user: User = Depends(get_current_user)):
    """
    Get quote for a symbol.
    Reads from Redis cache first (written by market_data_worker from master session).
    Falls back to direct provider fetch, then yfinance.
    """
    # 1. Try Redis cache (written by master session worker)
    try:
        from cache.redis_client import get_quote as redis_get_quote
        cached = await redis_get_quote(symbol)
        if cached:
            return cached
    except Exception as e:
        logger.debug(f"Redis quote read failed ({symbol}): {e}")

    # 2. Fallback: fetch via user's provider or yfinance
    quote = await market_data.get_quote_safe(symbol, user.id)
    if not quote:
        raise HTTPException(status_code=404, detail="Symbol not found or data unavailable")
    return quote


@router.get("/search")
async def search_stocks(q: str = Query(..., min_length=1)):
    """Search is provider-independent — no auth required."""
    results = await market_data.search_stocks(q)
    return {"results": results}


@router.get("/history/{symbol}")
async def get_history(
    symbol: str,
    period: str = Query("1mo", pattern="^(1d|5d|1mo|3mo|6mo|1y|2y|3y|5y|max)$"),
    interval: str = Query("1d", pattern="^(1m|3m|5m|10m|15m|30m|1h|2h|4h|1d|1wk|1mo)$"),
    user: User = Depends(get_current_user),
):
    """Historical OHLCV — checks Redis cache, falls back to provider/yfinance."""
    # Try Redis cache for history
    try:
        from cache.redis_client import get_history as redis_get_history
        cached = await redis_get_history(symbol, period, interval)
        if cached:
            return {"symbol": symbol, "candles": cached, "count": len(cached), "source": "cache"}
    except Exception as e:
        logger.debug(f"Redis history read failed ({symbol}): {e}")

    data = await market_data.get_historical_data(symbol, period, interval, user_id=user.id)

    # Write to Redis for next caller
    if data:
        try:
            from cache.redis_client import set_history as redis_set_history
            await redis_set_history(symbol, period, interval, data)
        except Exception:
            pass

    return {"symbol": symbol, "candles": data, "count": len(data)}


@router.get("/indices")
async def get_indices(user: User = Depends(get_current_user)):
    """
    Index quotes — reads from Redis (populated by master session worker).
    Falls back to live fetch if cache miss.
    """
    try:
        from cache.redis_client import get_indices as redis_get_indices
        cached = await redis_get_indices()
        if cached:
            return {"indices": cached}
    except Exception as e:
        logger.debug(f"Redis indices read failed: {e}")

    indices = await market_data.get_indices(user_id=user.id)
    return {"indices": indices}


@router.get("/ticker")
async def get_ticker(user: User = Depends(get_current_user)):
    """
    Ticker bar — reads from Redis cache first.
    Redis is populated every sweep by market_data_worker via master session.
    This means ALL logged-in users see live data without connecting their broker.
    """
    try:
        from cache.redis_client import get_ticker as redis_get_ticker
        cached = await redis_get_ticker()
        if cached:
            return {"items": cached, "source": "cache"}
    except Exception as e:
        logger.debug(f"Redis ticker read failed: {e}")

    # Cache miss — fetch live
    try:
        items = await market_data.get_ticker_data(user_id=user.id)
        # Write to Redis for next caller
        if items:
            try:
                from cache.redis_client import set_ticker as redis_set_ticker
                await redis_set_ticker(items)
            except Exception:
                pass
        return {"items": items}
    except Exception as e:
        logger.error(f"/api/market/ticker failed: {e}", exc_info=True)
        try:
            items = await market_data.get_public_ticker_data()
            return {"items": items}
        except Exception as fallback_error:
            raise HTTPException(status_code=503, detail="Market ticker temporarily unavailable") from fallback_error


@router.get("/ticker/public")
async def get_public_ticker():
    """
    Public ticker — NO auth required.
    Returns Redis-cached data if available, else yfinance.
    Used by the landing page / pre-login ticker bar.
    """
    try:
        from cache.redis_client import get_ticker as redis_get_ticker
        cached = await redis_get_ticker()
        if cached:
            return {"items": cached, "source": "cache"}
    except Exception:
        pass

    items = await market_data.get_public_ticker_data()
    return {"items": items}


@router.get("/popular")
async def get_popular_stocks():
    return {"stocks": market_data.POPULAR_INDIAN_STOCKS}


@router.get("/batch")
async def batch_quotes(
    symbols: str = Query(..., description="Comma-separated symbols"),
    user: User = Depends(get_current_user),
):
    symbol_list = [s.strip() for s in symbols.split(",") if s.strip()]

    # Try Redis for each symbol first
    results = {}
    missing = []
    try:
        from cache.redis_client import get_quote as redis_get_quote
        for sym in symbol_list:
            cached = await redis_get_quote(sym)
            if cached:
                results[sym] = cached
            else:
                missing.append(sym)
    except Exception:
        missing = symbol_list

    if missing:
        live = await market_data.get_batch_quotes(missing, user_id=user.id)
        results.update(live)

    return {"quotes": results}


@router.get("/provider/health")
async def provider_health(user: User = Depends(get_current_user)):
    from services.broker_session import broker_session_manager
    provider = broker_session_manager.get_session(user.id)
    if not provider:
        return {"status": "not_connected", "message": "No personal broker connected — using master session"}
    try:
        health = await provider.health()
        return health.to_dict()
    except Exception as e:
        return {"status": "error", "error": str(e)}
