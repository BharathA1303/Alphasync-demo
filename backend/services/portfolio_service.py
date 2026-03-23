from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from models.portfolio import Portfolio, Holding
from services import market_data
import logging
from decimal import Decimal

logger = logging.getLogger(__name__)


def _to_decimal(value) -> Decimal:
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


async def get_portfolio_summary(db: AsyncSession, user_id: str) -> dict:
    """Get complete portfolio summary with real-time P&L."""
    result = await db.execute(select(Portfolio).where(Portfolio.user_id == user_id))
    portfolio = result.scalar_one_or_none()

    if not portfolio:
        return {
            "total_invested": 0,
            "current_value": 0,
            "available_capital": 1000000,
            "total_pnl": 0,
            "total_pnl_percent": 0,
            "day_pnl": 0,
            "holdings_count": 0,
        }

    # Update holdings with live prices
    result = await db.execute(
        select(Holding).where(Holding.portfolio_id == portfolio.id)
    )
    holdings = result.scalars().all()

    total_invested = Decimal("0")
    current_value = Decimal("0")

    for holding in holdings:
        quantity = _to_decimal(holding.quantity or 0)
        avg_price = _to_decimal(holding.avg_price or 0)
        invested_value = avg_price * quantity

        # Recompute deterministic base values on every request so stale DB values
        # never skew summary totals.
        holding.invested_value = invested_value
        holding.current_price = avg_price
        holding.current_value = invested_value
        holding.pnl = Decimal("0")
        holding.pnl_percent = Decimal("0")

        quote = await market_data.get_quote_safe(holding.symbol, user_id)
        if quote and quote.get("price"):
            live_price = _to_decimal(quote["price"])
            holding.current_price = live_price
            holding.current_value = live_price * quantity
            holding.pnl = holding.current_value - invested_value
            holding.pnl_percent = (
                (holding.pnl / invested_value * 100) if invested_value else Decimal("0")
            )

        total_invested += invested_value
        current_value += _to_decimal(holding.current_value or 0)

    portfolio.total_invested = total_invested
    portfolio.current_value = current_value
    unrealized_pnl = current_value - total_invested
    realized_pnl = _to_decimal(portfolio.total_pnl or 0)

    return {
        "total_invested": float(round(total_invested, 2)),
        "current_value": float(round(current_value, 2)),
        "available_capital": float(round(portfolio.available_capital, 2)),
        "total_pnl": float(round(realized_pnl + unrealized_pnl, 2)),
        "total_pnl_percent": float(
            round(
                (
                    ((realized_pnl + unrealized_pnl) / total_invested * 100)
                    if total_invested
                    else 0
                ),
                2,
            )
        ),
        "realized_pnl": float(round(realized_pnl, 2)),
        "unrealized_pnl": float(round(unrealized_pnl, 2)),
        "holdings_count": len(holdings),
    }


async def get_holdings(db: AsyncSession, user_id: str) -> list:
    """Get all holdings with live prices."""
    result = await db.execute(select(Portfolio).where(Portfolio.user_id == user_id))
    portfolio = result.scalar_one_or_none()
    if not portfolio:
        return []

    result = await db.execute(
        select(Holding).where(Holding.portfolio_id == portfolio.id)
    )
    holdings = result.scalars().all()

    holdings_list = []
    for h in holdings:
        quantity = _to_decimal(h.quantity or 0)
        avg_price = _to_decimal(h.avg_price or 0)
        invested_value = avg_price * quantity

        # Deterministic baseline to avoid stale persisted values.
        h.invested_value = invested_value
        h.current_price = avg_price
        h.current_value = invested_value
        h.pnl = Decimal("0")
        h.pnl_percent = Decimal("0")

        quote = await market_data.get_quote_safe(h.symbol, user_id)
        if quote and quote.get("price"):
            live_price = _to_decimal(quote["price"])
            h.current_price = live_price
            h.current_value = live_price * quantity
            h.pnl = h.current_value - invested_value
            h.pnl_percent = (h.pnl / invested_value * 100) if invested_value else Decimal("0")

        holdings_list.append(
            {
                "id": str(h.id),
                "symbol": h.symbol,
                "company_name": h.company_name or h.symbol.replace(".NS", ""),
                "exchange": h.exchange,
                "quantity": h.quantity,
                "avg_price": float(round(h.avg_price, 2)),
                "current_price": float(round(h.current_price, 2)),
                "invested_value": float(round(h.invested_value, 2)),
                "current_value": float(round(h.current_value, 2)),
                "pnl": float(round(h.pnl, 2)),
                "pnl_percent": float(round(h.pnl_percent, 2)),
            }
        )

    return holdings_list
