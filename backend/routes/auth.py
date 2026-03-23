"""
Authentication routes — Firebase-based.

Flow:
    1. Frontend signs user in via Firebase JS SDK (Google, Email/Password, etc.)
    2. Frontend gets a Firebase ID token and sends it to POST /api/auth/sync
    3. Backend verifies the token via Firebase Admin SDK
    4. Backend finds-or-creates a local User row (linked by firebase_uid)
    5. Backend returns the local user profile
    6. All subsequent API calls send the Firebase ID token as Bearer token
    7. get_current_user() verifies the token on every request
"""

import logging
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone

from database.connection import get_db
from models.user import User
from models.portfolio import Portfolio
from services.auth_service import verify_id_token
from core.event_bus import event_bus, Event, EventType
from config.settings import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["Authentication"])
security = HTTPBearer(auto_error=False)


# --- Schemas ---


class SyncRequest(BaseModel):
    """Sent by frontend after Firebase sign-in to sync with backend."""

    username: Optional[str] = None


# --- Core Dependency: get_current_user ---


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> User:
    """
    Verify Firebase ID token and return the local User.

    Every protected route depends on this. The frontend sends the
    Firebase ID token as a Bearer token in the Authorization header.

    In DEBUG mode without Firebase credentials, a demo user is
    auto-created so the app works out of the box.
    """
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # Verify Firebase ID token
    claims = verify_id_token(credentials.credentials)
    if not claims:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    firebase_uid = claims.get("uid")
    if not firebase_uid:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    # Look up local user by firebase_uid
    result = await db.execute(select(User).where(User.firebase_uid == firebase_uid))
    user = result.scalar_one_or_none()

    if not user:
        # In DEBUG mode, auto-create the demo user so the app works
        # without any Firebase setup
        if settings.DEBUG:
            email = claims.get("email", "demo@alphasync.app")
            user = User(
                firebase_uid=firebase_uid,
                email=email,
                username=claims.get("name", "demo_trader").lower().replace(" ", "_"),
                full_name=claims.get("name", "Demo Trader"),
                auth_provider="demo",
                virtual_capital=settings.DEFAULT_VIRTUAL_CAPITAL,
                is_verified=True,
                is_active=True,
            )
            db.add(user)
            await db.flush()

            # Create portfolio for the demo user
            portfolio = Portfolio(
                user_id=user.id,
                available_capital=settings.DEFAULT_VIRTUAL_CAPITAL,
            )
            db.add(portfolio)
            await db.commit()
            await db.refresh(user)
            logger.info(f"Auto-created demo user: {user.email} (uid={firebase_uid})")
        else:
            raise HTTPException(
                status_code=401,
                detail="User not found. Please sign in again.",
            )

    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is deactivated")

    return user


# --- Routes ---


@router.post("/sync")
async def sync_user(
    req: SyncRequest,
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db),
):
    """
    Sync Firebase user with local database.

    Called by the frontend after every Firebase sign-in (login or register).
    Finds existing user by firebase_uid or creates a new one.
    Returns the local user profile for the frontend store.
    """
    if not credentials:
        logger.warning("Sync called without credentials")
        raise HTTPException(status_code=401, detail="Not authenticated")

    token = credentials.credentials
    logger.info(
        f"Sync request — token length: {len(token)}, first 20 chars: {token[:20]}..."
    )

    claims = verify_id_token(token)
    if not claims:
        logger.error(
            "Firebase token verification failed — is FIREBASE_CREDENTIALS_JSON set?"
        )
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    firebase_uid = claims.get("uid")
    email = claims.get("email", "")
    name = claims.get("name", "")
    picture = claims.get("picture")
    email_verified = claims.get("email_verified", False)
    provider = claims.get("firebase", {}).get("sign_in_provider", "unknown")

    if not firebase_uid:
        raise HTTPException(status_code=401, detail="Invalid token")

    try:
        # Try to find existing user by firebase_uid
        result = await db.execute(select(User).where(User.firebase_uid == firebase_uid))
        user = result.scalar_one_or_none()

        is_new = False

        if not user:
            # Also check if email already exists (edge case: migrated user)
            if email:
                result = await db.execute(select(User).where(User.email == email))
                user = result.scalar_one_or_none()

            if user:
                # Link existing email-based user to Firebase
                user.firebase_uid = firebase_uid
                user.auth_provider = provider
                if picture and not user.avatar_url:
                    user.avatar_url = picture
                if email_verified:
                    user.is_verified = True
            else:
                # Create brand-new user
                is_new = True

                # Generate username from email or name
                username = req.username
                if not username:
                    username = (
                        email.split("@")[0] if email else f"user_{firebase_uid[:8]}"
                    )

                # Ensure username uniqueness
                base_username = username
                counter = 1
                while True:
                    result = await db.execute(
                        select(User).where(User.username == username)
                    )
                    if not result.scalar_one_or_none():
                        break
                    username = f"{base_username}{counter}"
                    counter += 1

                user = User(
                    firebase_uid=firebase_uid,
                    email=email,
                    username=username,
                    full_name=name or username,
                    auth_provider=provider,
                    avatar_url=picture,
                    virtual_capital=settings.DEFAULT_VIRTUAL_CAPITAL,
                    is_verified=email_verified,
                )
                db.add(user)
                await db.flush()

                # Create portfolio for new user
                portfolio = Portfolio(
                    user_id=user.id,
                    available_capital=settings.DEFAULT_VIRTUAL_CAPITAL,
                )
                db.add(portfolio)

        # Update last login info
        user.updated_at = datetime.now(timezone.utc)

        await db.commit()
        await db.refresh(user)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Sync database error for {email} (firebase_uid={firebase_uid}): {e}",
            exc_info=True,
        )
        await db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Account sync failed: {type(e).__name__}: {e}",
        )

    uid = str(user.id)

    # Emit event
    event_bus.emit_nowait(
        Event(
            type=EventType.USER_LOGIN,
            data={
                "user_id": uid,
                "email": email,
                "action": "register" if is_new else "login",
                "provider": provider,
            },
            user_id=uid,
            source="auth",
        )
    )

    return {
        "message": "Registration successful" if is_new else "Login successful",
        "is_new_user": is_new,
        "user": {
            "id": uid,
            "email": user.email,
            "username": user.username,
            "full_name": user.full_name,
            "phone": user.phone,
            "role": user.role,
            "virtual_capital": float(user.virtual_capital),
            "avatar_url": user.avatar_url,
            "is_verified": user.is_verified,
            "auth_provider": user.auth_provider,
        },
    }


@router.get("/me")
async def get_me(user: User = Depends(get_current_user)):
    """Return current user profile."""
    return {
        "id": str(user.id),
        "email": user.email,
        "username": user.username,
        "full_name": user.full_name,
        "phone": user.phone,
        "role": user.role,
        "virtual_capital": float(user.virtual_capital),
        "avatar_url": user.avatar_url,
        "is_verified": user.is_verified,
        "auth_provider": user.auth_provider,
        "created_at": user.created_at.isoformat() if user.created_at else None,
    }


@router.post("/logout")
async def logout(
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    """
    Server-side logout acknowledgment.

    The actual sign-out happens on the client (Firebase signOut).
    This endpoint is for event tracking and any server-side cleanup.
    """
    user_id = None
    if credentials:
        claims = verify_id_token(credentials.credentials)
        if claims:
            user_id = claims.get("uid")

    if user_id:
        event_bus.emit_nowait(
            Event(
                type=EventType.USER_LOGOUT,
                data={"firebase_uid": user_id},
                user_id=user_id,
                source="auth",
            )
        )

    return {"message": "Logged out successfully"}
