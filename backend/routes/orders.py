from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional
from database.connection import get_db
from models.user import User
from models.order import Order
from routes.auth import get_current_user
from services.trading_engine import place_order, cancel_order
from engines.market_session import market_session

router = APIRouter(prefix="/api/orders", tags=["Orders"])


# Frontend → Backend order-type mapping
_ORDER_TYPE_MAP = {
    "SL": "STOP_LOSS",
    "SL-M": "STOP_LOSS_LIMIT",
}


class PlaceOrderRequest(BaseModel):
    symbol: str
    side: str  # BUY or SELL
    order_type: str = "MARKET"  # MARKET, LIMIT, SL, SL-M
    product_type: str = "CNC"  # CNC (delivery), MIS (intraday), NRML (F&O)
    quantity: int
    price: Optional[float] = None
    trigger_price: Optional[float] = None
    client_price: Optional[float] = None  # Fallback price from chart for simulation


@router.post("")
async def create_order(
    req: PlaceOrderRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if req.side not in ("BUY", "SELL"):
        raise HTTPException(status_code=400, detail="Side must be BUY or SELL")
    if req.quantity <= 0:
        raise HTTPException(status_code=400, detail="Quantity must be positive")

    # Enforce market hours — all trades are simulated but only during market open
    if not market_session.can_place_orders():
        session_info = market_session.get_session_info()
        state = session_info["state"]
        state_label = {
            "weekend": "Weekend",
            "holiday": "Holiday",
            "closed": "Market Closed",
            "after_market": "After Market Hours",
        }.get(state, "Market Closed")
        raise HTTPException(
            status_code=400,
            detail=f"Cannot place orders — {state_label}. Trading is available Mon–Fri 9:15 AM – 3:30 PM IST.",
        )

    # Map frontend order types (SL, SL-M) to backend equivalents
    order_type = _ORDER_TYPE_MAP.get(req.order_type, req.order_type)

    result = await place_order(
        db=db,
        user_id=user.id,
        symbol=req.symbol,
        side=req.side,
        order_type=order_type,
        product_type=req.product_type,
        quantity=req.quantity,
        price=req.price,
        trigger_price=req.trigger_price,
        client_price=req.client_price,
    )

    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])

    return result


@router.get("")
async def get_orders(
    status_filter: Optional[str] = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(Order).where(Order.user_id == user.id)
    if status_filter:
        query = query.where(Order.status == status_filter)
    query = query.order_by(Order.created_at.desc())

    result = await db.execute(query)
    orders = result.scalars().all()

    return {
        "orders": [
            {
                "id": str(o.id),
                "symbol": o.symbol,
                "exchange": o.exchange,
                "order_type": o.order_type,
                "side": o.side,
                "product_type": o.product_type,
                "quantity": o.quantity,
                "price": float(o.price) if o.price is not None else None,
                "trigger_price": (
                    float(o.trigger_price) if o.trigger_price is not None else None
                ),
                "filled_quantity": o.filled_quantity,
                "filled_price": (
                    float(o.filled_price) if o.filled_price is not None else None
                ),
                "status": o.status,
                "created_at": o.created_at.isoformat() if o.created_at else None,
                "executed_at": o.executed_at.isoformat() if o.executed_at else None,
            }
            for o in orders
        ]
    }


@router.get("/{order_id}")
async def get_order(
    order_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Order).where(Order.id == order_id, Order.user_id == user.id)
    )
    order = result.scalar_one_or_none()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    return {
        "id": str(order.id),
        "symbol": order.symbol,
        "exchange": order.exchange,
        "order_type": order.order_type,
        "side": order.side,
        "product_type": order.product_type,
        "quantity": order.quantity,
        "price": float(order.price) if order.price is not None else None,
        "trigger_price": (
            float(order.trigger_price) if order.trigger_price is not None else None
        ),
        "filled_quantity": order.filled_quantity,
        "filled_price": (
            float(order.filled_price) if order.filled_price is not None else None
        ),
        "status": order.status,
        "created_at": order.created_at.isoformat() if order.created_at else None,
        "executed_at": order.executed_at.isoformat() if order.executed_at else None,
    }


@router.delete("/{order_id}")
async def delete_order(
    order_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await cancel_order(db, user.id, order_id)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])
    return result
