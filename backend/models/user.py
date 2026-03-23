import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    Column,
    String,
    Boolean,
    Numeric,
    DateTime,
    Index,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from database.connection import Base


def _utcnow():
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    firebase_uid = Column(String(128), unique=True, nullable=True, index=True)
    auth_provider = Column(
        String(30),
        default="firebase",
        nullable=False,
        server_default=text("'firebase'"),
    )
    email = Column(String(255), unique=True, nullable=False, index=True)
    username = Column(String(50), unique=True, nullable=False, index=True)
    password_hash = Column(
        String(255), nullable=True
    )  # nullable — Firebase users have no password
    full_name = Column(String(100), nullable=False)
    is_verified = Column(
        Boolean, default=False, nullable=False, server_default=text("false")
    )
    is_active = Column(
        Boolean, default=True, nullable=False, server_default=text("true")
    )
    virtual_capital = Column(
        Numeric(precision=16, scale=2), default=1000000.0, nullable=False
    )
    role = Column(
        String(20), default="user", nullable=False, server_default=text("'user'")
    )
    avatar_url = Column(String(500), nullable=True)
    phone = Column(String(20), nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        default=_utcnow,
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=_utcnow,
        onupdate=_utcnow,
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )

    # Relationships
    portfolio = relationship(
        "Portfolio", back_populates="user", uselist=False, cascade="all, delete-orphan"
    )
    orders = relationship("Order", back_populates="user", cascade="all, delete-orphan")
    watchlists = relationship(
        "Watchlist", back_populates="user", cascade="all, delete-orphan"
    )
    algo_strategies = relationship(
        "AlgoStrategy", back_populates="user", cascade="all, delete-orphan"
    )

    __table_args__ = (Index("ix_users_role_active", "role", "is_active"),)
