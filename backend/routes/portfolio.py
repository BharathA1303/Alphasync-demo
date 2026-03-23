from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from database.connection import get_db
from models.user import User
from routes.auth import get_current_user
from services.portfolio_service import get_portfolio_summary, get_holdings

router = APIRouter(prefix="/api/portfolio", tags=["Portfolio"])


@router.get("")
async def get_portfolio(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    summary = await get_portfolio_summary(db, user.id)
    return summary


@router.get("/holdings")
async def get_user_holdings(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    holdings = await get_holdings(db, user.id)
    return {"holdings": holdings}


@router.get("/summary")
async def get_summary(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    summary = await get_portfolio_summary(db, user.id)
    holdings = await get_holdings(db, user.id)
    return {
        "summary": summary,
        "holdings": holdings,
    }
