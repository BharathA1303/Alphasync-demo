"""
AlphaSync ZeroLoss — Signal Generator.

Consumes the ConfidenceEngine's scored output and decides the trade
direction (LONG / SHORT / NO_TRADE).  Also computes entry, stop-loss,
and target levels by delegating cost calculation to BreakevenManager.

The NO_TRADE signal IS the zero-loss guarantee: if market conditions
are ambiguous, the strategy simply stays out.

Usage:
    from strategies.zeroloss.signal_generator import ZeroLossSignalGenerator

    gen = ZeroLossSignalGenerator(threshold=75)
    signal = gen.generate(confidence, current_price=1401.80)
"""

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

from strategies.zeroloss.confidence_engine import ConfidenceBreakdown
from strategies.zeroloss.breakeven_manager import BreakevenManager, TradeLevels

logger = logging.getLogger(__name__)


# ── Signal data classes ────────────────────────────────────────────────────────


@dataclass
class ZeroLossSignal:
    """Output of the signal generator — a complete trade instruction."""

    symbol: str
    timestamp: datetime
    direction: str  # "LONG", "SHORT", "NO_TRADE"
    confidence_score: float  # 0 – 100

    # Populated only when direction != NO_TRADE
    entry_price: Optional[float] = None
    stop_loss: Optional[float] = None
    target: Optional[float] = None
    risk_reward_ratio: Optional[float] = None

    # Metadata
    status: str = "WAITING"  # WAITING / ACTIVE / PROFIT / BREAKEVEN
    reasons: list[str] = field(default_factory=list)
    indicator_snapshot: Optional[dict] = None

    def to_dict(self) -> dict:
        """Serialise for API / WebSocket transport."""
        return {
            "symbol": self.symbol,
            "timestamp": self.timestamp.isoformat(),
            "direction": self.direction,
            "confidence_score": self.confidence_score,
            "entry_price": self.entry_price,
            "stop_loss": self.stop_loss,
            "target": self.target,
            "risk_reward_ratio": self.risk_reward_ratio,
            "status": self.status,
            "reasons": self.reasons,
            "indicator_snapshot": self.indicator_snapshot,
        }


class ZeroLossSignalGenerator:
    """
    Converts a ConfidenceBreakdown into a tradeable ZeroLossSignal.

    Rules:
        1. If confidence < threshold → NO_TRADE (the no-loss condition).
        2. If confidence >= threshold AND direction is BULLISH → LONG.
        3. If confidence >= threshold AND direction is BEARISH → SHORT.
        4. If direction is NEUTRAL (even with high score)     → NO_TRADE.
        5. Compute break-even stop and 1:3 RR target.
    """

    def __init__(
        self,
        confidence_threshold: float = 75.0,
        risk_reward_ratio: float = 3.0,
    ):
        """
        Args:
            confidence_threshold: Minimum score required to enter a trade.
            risk_reward_ratio: Target profit as a multiple of risk (after costs).
        """
        self.threshold = confidence_threshold
        self.rr_ratio = risk_reward_ratio
        self.breakeven = BreakevenManager()

    def generate(
        self,
        confidence: ConfidenceBreakdown,
        symbol: str,
        current_price: float,
        quantity: int = 1,
    ) -> ZeroLossSignal:
        """
        Produce a trade signal from the confidence analysis.

        Args:
            confidence:    Output from ConfidenceEngine.score().
            symbol:        NSE symbol (e.g. "RELIANCE.NS").
            current_price: Latest traded price.
            quantity:      Order quantity (used for cost scaling).

        Returns:
            ZeroLossSignal with all trade levels populated (or NO_TRADE).
        """
        now = datetime.now(timezone.utc)

        # Build indicator snapshot for the signal record
        indicator_snapshot = {
            "ema_20": confidence.ema_20,
            "ema_50": confidence.ema_50,
            "ema_200": confidence.ema_200,
            "rsi": confidence.rsi,
            "macd_hist": confidence.macd_hist,
            "volume_ratio": confidence.volume_ratio,
            "vix": confidence.vix,
        }

        # ── Gate 1: Confidence threshold ───────────────────────────
        if confidence.total < self.threshold:
            logger.info(
                f"[{symbol}] NO_TRADE — confidence {confidence.total:.1f} "
                f"< threshold {self.threshold}"
            )
            return ZeroLossSignal(
                symbol=symbol,
                timestamp=now,
                direction="NO_TRADE",
                confidence_score=confidence.total,
                status="WAITING",
                reasons=[
                    f"Confidence {confidence.total:.1f} below "
                    f"threshold {self.threshold}",
                    *confidence.reasons,
                ],
                indicator_snapshot=indicator_snapshot,
            )

        # ── Gate 2: Clear direction required ───────────────────────
        if confidence.direction == "NEUTRAL":
            logger.info(
                f"[{symbol}] NO_TRADE — neutral direction despite "
                f"score {confidence.total:.1f}"
            )
            return ZeroLossSignal(
                symbol=symbol,
                timestamp=now,
                direction="NO_TRADE",
                confidence_score=confidence.total,
                status="WAITING",
                reasons=[
                    "Direction NEUTRAL — no clear trend",
                    *confidence.reasons,
                ],
                indicator_snapshot=indicator_snapshot,
            )

        # ── Determine direction ────────────────────────────────────
        direction = "LONG" if confidence.direction == "BULLISH" else "SHORT"

        # ── Compute trade levels via BreakevenManager ──────────────
        levels: TradeLevels = self.breakeven.compute_levels(
            entry_price=current_price,
            direction=direction,
            quantity=quantity,
            risk_reward_ratio=self.rr_ratio,
        )

        logger.info(
            f"[{symbol}] {direction} signal | "
            f"Confidence: {confidence.total:.1f} | "
            f"Entry: {levels.entry:.2f} | "
            f"SL: {levels.stop_loss:.2f} | "
            f"Target: {levels.target:.2f} | "
            f"RR: 1:{levels.risk_reward_ratio:.1f}"
        )

        return ZeroLossSignal(
            symbol=symbol,
            timestamp=now,
            direction=direction,
            confidence_score=confidence.total,
            entry_price=levels.entry,
            stop_loss=levels.stop_loss,
            target=levels.target,
            risk_reward_ratio=levels.risk_reward_ratio,
            status="WAITING",
            reasons=confidence.reasons,
            indicator_snapshot=indicator_snapshot,
        )
