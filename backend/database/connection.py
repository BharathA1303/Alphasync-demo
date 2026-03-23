from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import text
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.dialects.postgresql import UUID as PG_UUID, JSONB as PG_JSONB
from config.settings import settings


@compiles(PG_UUID, "sqlite")
def _compile_pg_uuid_for_sqlite(_type, _compiler, **_kw):
    return "CHAR(36)"


@compiles(PG_JSONB, "sqlite")
def _compile_pg_jsonb_for_sqlite(_type, _compiler, **_kw):
    return "JSON"

engine_kwargs = {
    "echo": settings.DEBUG,
    "future": True,
}

if not settings.DATABASE_URL.startswith("sqlite"):
    engine_kwargs.update(
        {
            "pool_size": settings.DB_POOL_SIZE,
            "max_overflow": settings.DB_MAX_OVERFLOW,
            "pool_recycle": settings.DB_POOL_RECYCLE,
            "pool_pre_ping": settings.DB_POOL_PRE_PING,
        }
    )

engine = create_async_engine(settings.DATABASE_URL, **engine_kwargs)

async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

# Alias for background workers that need direct session access
# (not via FastAPI's Depends(get_db) dependency injection)
async_session_factory = async_session


class Base(DeclarativeBase):
    pass


async def get_db():
    async with async_session() as session:
        try:
            yield session
            # Only auto-commit if the route didn't already commit/rollback
            if session.is_active:
                await session.commit()
        except Exception:
            if session.is_active:
                await session.rollback()
            raise


async def init_db():
    async with engine.begin() as conn:
        is_postgres = conn.dialect.name == "postgresql"

        if is_postgres:
            # Ensure uuid-ossp extension is available for gen_random_uuid()
            # Wrapped in DO block to handle race condition when multiple workers start simultaneously
            await conn.execute(
                text(
                    """
                DO $$ BEGIN
                    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
                EXCEPTION WHEN duplicate_object THEN NULL;
                END $$;
            """
                )
            )
        from models import user, order, portfolio, watchlist, algo  # noqa
        from models import broker as broker_model  # noqa
        from strategies.zeroloss import models as zeroloss_models  # noqa

        await conn.run_sync(Base.metadata.create_all)

        if is_postgres:
            # ── Add missing columns for Firebase auth migration ─────────────
            # create_all doesn't ALTER existing tables — add columns manually
            # if they're missing (idempotent).
            await conn.execute(
                text(
                    """
                DO $$ BEGIN
                    -- Add firebase_uid column if missing
                    IF NOT EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'users' AND column_name = 'firebase_uid'
                    ) THEN
                        ALTER TABLE users ADD COLUMN firebase_uid VARCHAR(128) UNIQUE;
                        CREATE INDEX IF NOT EXISTS ix_users_firebase_uid ON users (firebase_uid);
                    END IF;

                    -- Add auth_provider column if missing
                    IF NOT EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'users' AND column_name = 'auth_provider'
                    ) THEN
                        ALTER TABLE users ADD COLUMN auth_provider VARCHAR(30) NOT NULL DEFAULT 'firebase';
                    END IF;

                    -- Make password_hash nullable (Firebase users have no password)
                    ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
                EXCEPTION WHEN others THEN
                    RAISE NOTICE 'Migration note: %', SQLERRM;
                END $$;
            """
                )
            )

            # ── Add product_type column to orders table ───────────────────
            # CNC (Delivery), MIS (Intraday), NRML (F&O) — mirrors real
            # Indian broker product types.
            await conn.execute(
                text(
                    """
                DO $$ BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'orders' AND column_name = 'product_type'
                    ) THEN
                        ALTER TABLE orders ADD COLUMN product_type VARCHAR(10) NOT NULL DEFAULT 'CNC';
                    END IF;
                EXCEPTION WHEN others THEN
                    RAISE NOTICE 'Migration note: %', SQLERRM;
                END $$;
            """
                )
            )
