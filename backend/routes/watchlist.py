from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from pydantic import BaseModel
import uuid
from database.connection import get_db
from models.user import User
from models.watchlist import Watchlist, WatchlistItem
from routes.auth import get_current_user

router = APIRouter(prefix="/api/watchlist", tags=["Watchlist"])


class CreateWatchlistRequest(BaseModel):
    name: str = "My Watchlist"


class RenameWatchlistRequest(BaseModel):
    name: str


class AddItemRequest(BaseModel):
    symbol: str
    exchange: str = "NSE"


def _normalize_uuid(value: str, field_name: str) -> str:
    try:
        return str(uuid.UUID(str(value)))
    except Exception:
        raise HTTPException(status_code=400, detail=f"Invalid {field_name}")


@router.get("")
async def get_watchlists(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user_id = str(user.id)
    result = await db.execute(select(Watchlist).where(Watchlist.user_id == user_id))
    watchlists = result.scalars().all()

    wl_list = []
    for wl in watchlists:
        items_result = await db.execute(
            select(WatchlistItem).where(WatchlistItem.watchlist_id == wl.id)
        )
        items = items_result.scalars().all()
        wl_list.append(
            {
                "id": str(wl.id),
                "name": wl.name,
                "items": [
                    {"id": str(i.id), "symbol": i.symbol, "exchange": i.exchange}
                    for i in items
                ],
            }
        )

    return {"watchlists": wl_list}


@router.post("")
async def create_watchlist(
    req: CreateWatchlistRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new watchlist — unlimited per user."""
    name = req.name.strip() or "My Watchlist"
    watchlist_id = uuid.uuid4().hex
    user_id = uuid.UUID(_normalize_uuid(str(user.id), "user_id")).hex
    await db.execute(
        text(
            """
            INSERT INTO watchlists (id, user_id, name)
            VALUES (:id, :user_id, :name)
            """
        ),
        {
            "id": watchlist_id,
            "user_id": user_id,
            "name": name,
        },
    )
    await db.flush()
    return {"id": watchlist_id, "name": name, "items": []}


@router.patch("/{watchlist_id}")
async def rename_watchlist(
    watchlist_id: str,
    req: RenameWatchlistRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    watchlist_uuid = _normalize_uuid(watchlist_id, "watchlist_id")
    user_id = str(user.id)

    result = await db.execute(
        select(Watchlist).where(
            Watchlist.id == watchlist_uuid, Watchlist.user_id == user_id
        )
    )
    wl = result.scalar_one_or_none()
    if not wl:
        raise HTTPException(status_code=404, detail="Watchlist not found")

    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name cannot be empty")

    wl.name = name
    await db.flush()
    return {"id": str(wl.id), "name": wl.name}


@router.post("/{watchlist_id}/items")
async def add_item(
    watchlist_id: str,
    req: AddItemRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    watchlist_uuid = uuid.UUID(_normalize_uuid(watchlist_id, "watchlist_id"))
    user_uuid = uuid.UUID(_normalize_uuid(str(user.id), "user_id"))

    watchlist_id_dash = str(watchlist_uuid)
    watchlist_id_hex = watchlist_uuid.hex
    user_id_dash = str(user_uuid)
    user_id_hex = user_uuid.hex

    symbol = (req.symbol or "").strip().upper()
    exchange = (req.exchange or "NSE").strip().upper()

    if not symbol:
        raise HTTPException(status_code=400, detail="Symbol is required")

    try:
        wl_result = await db.execute(
            text(
                """
                SELECT id
                FROM watchlists
                WHERE id IN (:wid_dash, :wid_hex)
                  AND user_id IN (:uid_dash, :uid_hex)
                LIMIT 1
                """
            ),
            {
                "wid_dash": watchlist_id_dash,
                "wid_hex": watchlist_id_hex,
                "uid_dash": user_id_dash,
                "uid_hex": user_id_hex,
            },
        )
        wl_row = wl_result.first()
        if not wl_row:
            raise HTTPException(status_code=404, detail="Watchlist not found")
        db_watchlist_id = wl_row[0]

        existing_result = await db.execute(
            text(
                """
                SELECT id, symbol, exchange
                FROM watchlist_items
                WHERE watchlist_id = :watchlist_id
                  AND UPPER(symbol) = :symbol
                LIMIT 1
                """
            ),
            {
                "watchlist_id": db_watchlist_id,
                "symbol": symbol,
            },
        )
        existing_row = existing_result.first()
        if existing_row:
            raise HTTPException(status_code=400, detail="Symbol already in watchlist")

        item_id = uuid.uuid4().hex
        await db.execute(
            text(
                """
                INSERT INTO watchlist_items (id, watchlist_id, symbol, exchange)
                VALUES (:id, :watchlist_id, :symbol, :exchange)
                """
            ),
            {
                "id": item_id,
                "watchlist_id": db_watchlist_id,
                "symbol": symbol,
                "exchange": exchange,
            },
        )
        await db.commit()
        return {"id": item_id, "symbol": symbol, "exchange": exchange}
    except HTTPException:
        raise
    except IntegrityError:
        await db.rollback()
        # Idempotent behavior on race/duplicate insert attempts.
        existing = await db.execute(
            text(
                """
                SELECT id, symbol, exchange
                FROM watchlist_items
                WHERE watchlist_id IN (:wid_dash, :wid_hex)
                  AND UPPER(symbol) = :symbol
                LIMIT 1
                """
            ),
            {
                "wid_dash": watchlist_id_dash,
                "wid_hex": watchlist_id_hex,
                "symbol": symbol,
            },
        )
        existing_item = existing.first()
        if existing_item:
            return {
                "id": str(existing_item[0]),
                "symbol": existing_item[1],
                "exchange": existing_item[2],
            }
        raise HTTPException(status_code=400, detail="Symbol already in watchlist")
    except SQLAlchemyError as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to add symbol: {type(e).__name__}")
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to add symbol: {type(e).__name__}: {e}")


@router.delete("/{watchlist_id}")
async def delete_watchlist(
    watchlist_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    watchlist_uuid = _normalize_uuid(watchlist_id, "watchlist_id")
    user_id = str(user.id)

    result = await db.execute(
        select(Watchlist).where(
            Watchlist.id == watchlist_uuid, Watchlist.user_id == user_id
        )
    )
    wl = result.scalar_one_or_none()
    if not wl:
        raise HTTPException(status_code=404, detail="Watchlist not found")
    await db.delete(wl)
    return {"message": "Watchlist deleted"}


@router.delete("/{watchlist_id}/items/{item_id}")
async def remove_item(
    watchlist_id: str,
    item_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    watchlist_uuid = _normalize_uuid(watchlist_id, "watchlist_id")
    item_uuid = _normalize_uuid(item_id, "item_id")
    user_id = str(user.id)

    result = await db.execute(
        select(Watchlist).where(
            Watchlist.id == watchlist_uuid, Watchlist.user_id == user_id
        )
    )
    wl = result.scalar_one_or_none()
    if not wl:
        raise HTTPException(status_code=404, detail="Watchlist not found")

    result = await db.execute(
        select(WatchlistItem).where(
            WatchlistItem.id == item_uuid,
            WatchlistItem.watchlist_id == watchlist_uuid,
        )
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    await db.delete(item)
    return {"message": "Item removed"}
