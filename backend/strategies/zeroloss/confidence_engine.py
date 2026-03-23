"""
AlphaSync ZeroLoss — Confidence Engine.

Analyses multiple market dimensions and produces a composite confidence
score from 0 to 100.  The ZeroLoss Controller only allows trade entry
when this score reaches the configurable threshold (default 75).

Scoring breakdown (total = 100):
    EMA Stack Alignment   :  25 pts
    RSI Sweet-Zone        :  20 pts
    MACD Momentum         :  15 pts
    Volume Confirmation   :  15 pts
    Volatility Regime     :  15 pts
    Support/Resistance    :  10 pts

All indicator math is delegated to engines.indicators.IndicatorEngine
so this module stays focused on *scoring logic* only.

Usage:
    from strategies.zeroloss.confidence_engine import ConfidenceEngine

    engine = ConfidenceEngine()
    result = engine.score(closes, highs, lows, volumes, vix=14.5)
    if result.total >= 75:
        # Allow trade entry
"""

import logging
from dataclasses import dataclass, field
from typing import Optional

from engines.indicators import IndicatorEngine

logger = logging.getLogger(__name__)


# ── Scoring result ─────────────────────────────────────────────────────────────


@dataclass
class ConfidenceBreakdown:
    """Detailed breakdown returned by the Confidence Engine."""

    ema_score: float = 0.0  # 0 – 25
    rsi_score: float = 0.0  # 0 – 20
    macd_score: float = 0.0  # 0 – 15
    volume_score: float = 0.0  # 0 – 15
    volatility_score: float = 0.0  # 0 – 15
    sr_score: float = 0.0  # 0 – 10
    total: float = 0.0  # 0 – 100
    direction: str = "NEUTRAL"  # BULLISH / BEARISH / NEUTRAL
    reasons: list[str] = field(default_factory=list)

    # Raw indicator values for downstream consumers
    ema_20: Optional[float] = None
    ema_50: Optional[float] = None
    ema_200: Optional[float] = None
    rsi: Optional[float] = None
    macd_hist: Optional[float] = None
    volume_ratio: Optional[float] = None
    vix: Optional[float] = None


class ConfidenceEngine:
    """
    Multi-dimensional market confidence scorer.

    Stateless — call .score() with the latest price/volume arrays
    and an optional VIX reading.  Returns a ConfidenceBreakdown.
    """

    # ── Configurable thresholds ────────────────────────────────────

    # Minimum number of candles required to compute all indicators
    MIN_CANDLES = 55  # 50 for EMA-50 + 5 buffer; EMA-200 used when available

    # RSI sweet-zone boundaries
    RSI_BULL_LOW = 40.0
    RSI_BULL_HIGH = 65.0
    RSI_BEAR_LOW = 35.0
    RSI_BEAR_HIGH = 60.0

    # VIX regime bands (India VIX)
    VIX_LOW = 12.0  # calm — full score
    VIX_MED = 18.0  # moderate — partial score
    VIX_HIGH = 25.0  # volatile — low score

    # Volume confirmation ratio (current / 20-period avg)
    VOL_CONFIRM_RATIO = 1.2

    def score(
        self,
        closes: list[float],
        highs: list[float],
        lows: list[float],
        volumes: list[int],
        vix: Optional[float] = None,
    ) -> ConfidenceBreakdown:
        """
        Compute the composite confidence score.

        Args:
            closes:  List of closing prices (oldest → newest).
            highs:   List of high prices.
            lows:    List of low prices.
            volumes: List of trade volumes.
            vix:     Latest India VIX reading (optional; defaults to 15).

        Returns:
            ConfidenceBreakdown with individual + total scores.
        """
        result = ConfidenceBreakdown()

        if len(closes) < self.MIN_CANDLES:
            result.reasons.append(
                f"Insufficient data: need {self.MIN_CANDLES} candles, got {len(closes)}"
            )
            return result

        # ── 1. EMA Stack (25 pts) ──────────────────────────────────
        result.ema_score, result.direction = self._score_ema_stack(closes, result)

        # ── 2. RSI Sweet-Zone (20 pts) ─────────────────────────────
        result.rsi_score = self._score_rsi(closes, result)

        # ── 3. MACD Momentum (15 pts) ──────────────────────────────
        result.macd_score = self._score_macd(closes, result)

        # ── 4. Volume Confirmation (15 pts) ────────────────────────
        result.volume_score = self._score_volume(volumes, result)

        # ── 5. Volatility Regime / VIX (15 pts) ───────────────────
        result.volatility_score = self._score_volatility(vix, result)

        # ── 6. Support / Resistance Proximity (10 pts) ────────────
        result.sr_score = self._score_support_resistance(closes, highs, lows, result)

        # ── Total ──────────────────────────────────────────────────
        result.total = round(
            result.ema_score
            + result.rsi_score
            + result.macd_score
            + result.volume_score
            + result.volatility_score
            + result.sr_score,
            2,
        )

        logger.debug(
            f"Confidence score: {result.total}/100 | "
            f"Direction: {result.direction} | "
            f"EMA={result.ema_score} RSI={result.rsi_score} "
            f"MACD={result.macd_score} VOL={result.volume_score} "
            f"VIX={result.volatility_score} SR={result.sr_score}"
        )

        return result

    # ── Component Scorers ──────────────────────────────────────────────────────

    def _score_ema_stack(
        self,
        closes: list[float],
        result: ConfidenceBreakdown,
    ) -> tuple[float, str]:
        """
        EMA Stack Alignment — up to 25 points.

        Bullish stack:  EMA20 > EMA50 > EMA200  → 25 pts
        Bearish stack:  EMA20 < EMA50 < EMA200  → 25 pts
        Partial align:  Two out of three         → 12 pts
        No alignment:                            →  0 pts
        """
        ema_20 = IndicatorEngine.ema(closes, 20)
        ema_50 = IndicatorEngine.ema(closes, 50)
        ema_200 = IndicatorEngine.ema(closes, 200) if len(closes) >= 210 else None

        e20 = ema_20[-1]
        e50 = ema_50[-1]
        e200 = ema_200[-1] if ema_200 is not None else None

        result.ema_20 = e20
        result.ema_50 = e50
        result.ema_200 = e200

        if e20 is None or e50 is None:
            result.reasons.append("EMA data incomplete — scored 0")
            return 0.0, "NEUTRAL"

        # When EMA-200 is available, use full 3-EMA stack
        if e200 is not None:
            # Full bullish stack
            if e20 > e50 > e200:
                result.reasons.append("EMA stack fully bullish (20 > 50 > 200)")
                return 25.0, "BULLISH"

            # Full bearish stack
            if e20 < e50 < e200:
                result.reasons.append("EMA stack fully bearish (20 < 50 < 200)")
                return 25.0, "BEARISH"

            # Partial bullish: price above EMA-200, short EMAs converging
            if e20 > e200 and e50 > e200:
                result.reasons.append("Partial bullish: EMA20 & EMA50 above EMA200")
                return 12.0, "BULLISH"

            # Partial bearish
            if e20 < e200 and e50 < e200:
                result.reasons.append("Partial bearish: EMA20 & EMA50 below EMA200")
                return 12.0, "BEARISH"

            result.reasons.append("EMA stack mixed — no clear direction")
            return 0.0, "NEUTRAL"

        # Fallback: only EMA-20 and EMA-50 available
        if e20 > e50:
            result.reasons.append("EMA-20 > EMA-50 — bullish trend (no EMA-200)")
            return 18.0, "BULLISH"
        if e20 < e50:
            result.reasons.append("EMA-20 < EMA-50 — bearish trend (no EMA-200)")
            return 18.0, "BEARISH"

        result.reasons.append("EMA flat — no direction (no EMA-200)")
        return 0.0, "NEUTRAL"

    def _score_rsi(
        self,
        closes: list[float],
        result: ConfidenceBreakdown,
    ) -> float:
        """
        RSI Sweet-Zone — up to 20 points.

        LONG sweet-zone:  RSI 40–65  → 20 pts
        SHORT sweet-zone: RSI 35–60  → 20 pts
        Near edge (±5):              → 10 pts
        Outside:                     →  0 pts
        """
        rsi_vals = IndicatorEngine.rsi(closes, 14)
        rsi = rsi_vals[-1]
        result.rsi = rsi

        if rsi is None:
            result.reasons.append("RSI data incomplete — scored 0")
            return 0.0

        direction = result.direction

        if direction == "BULLISH":
            if self.RSI_BULL_LOW <= rsi <= self.RSI_BULL_HIGH:
                result.reasons.append(f"RSI {rsi:.1f} in bullish sweet-zone (40–65)")
                return 20.0
            if (self.RSI_BULL_LOW - 5) <= rsi < self.RSI_BULL_LOW:
                result.reasons.append(f"RSI {rsi:.1f} near bullish zone edge")
                return 10.0
            if self.RSI_BULL_HIGH < rsi <= (self.RSI_BULL_HIGH + 5):
                result.reasons.append(f"RSI {rsi:.1f} near overbought edge")
                return 10.0

        elif direction == "BEARISH":
            if self.RSI_BEAR_LOW <= rsi <= self.RSI_BEAR_HIGH:
                result.reasons.append(f"RSI {rsi:.1f} in bearish sweet-zone (35–60)")
                return 20.0
            if (self.RSI_BEAR_LOW - 5) <= rsi < self.RSI_BEAR_LOW:
                result.reasons.append(f"RSI {rsi:.1f} near oversold edge")
                return 10.0
            if self.RSI_BEAR_HIGH < rsi <= (self.RSI_BEAR_HIGH + 5):
                result.reasons.append(f"RSI {rsi:.1f} near bearish zone edge")
                return 10.0

        result.reasons.append(f"RSI {rsi:.1f} outside sweet-zone for {direction}")
        return 0.0

    def _score_macd(
        self,
        closes: list[float],
        result: ConfidenceBreakdown,
    ) -> float:
        """
        MACD Momentum — up to 15 points.

        Histogram positive + growing → 15 pts (bullish)
        Histogram negative + growing → 15 pts (bearish)
        Histogram aligns with direction but not growing → 8 pts
        Histogram opposes direction → 0 pts
        """
        macd_result = IndicatorEngine.macd(closes)
        if macd_result is None:
            result.reasons.append("MACD data incomplete — scored 0")
            return 0.0

        hist = macd_result.histogram
        # Get last two valid histogram values
        valid_hist = [h for h in hist if h is not None]
        if len(valid_hist) < 2:
            result.reasons.append("MACD histogram insufficient — scored 0")
            return 0.0

        curr_hist = valid_hist[-1]
        prev_hist = valid_hist[-2]
        result.macd_hist = curr_hist
        growing = abs(curr_hist) > abs(prev_hist)
        direction = result.direction

        if direction == "BULLISH" and curr_hist > 0:
            if growing:
                result.reasons.append(
                    f"MACD histogram positive & growing ({curr_hist:.4f})"
                )
                return 15.0
            result.reasons.append(
                f"MACD histogram positive but fading ({curr_hist:.4f})"
            )
            return 8.0

        if direction == "BEARISH" and curr_hist < 0:
            if growing:
                result.reasons.append(
                    f"MACD histogram negative & growing ({curr_hist:.4f})"
                )
                return 15.0
            result.reasons.append(
                f"MACD histogram negative but fading ({curr_hist:.4f})"
            )
            return 8.0

        result.reasons.append(
            f"MACD histogram ({curr_hist:.4f}) opposes {direction} direction"
        )
        return 0.0

    def _score_volume(
        self,
        volumes: list[int],
        result: ConfidenceBreakdown,
    ) -> float:
        """
        Volume Confirmation — up to 15 points.

        Current volume >= 1.2x 20-period average → 15 pts
        Current volume >= 1.0x average            → 8 pts
        Below average                             → 0 pts
        """
        if len(volumes) < 20:
            result.reasons.append("Volume data insufficient (<20 bars)")
            return 0.0

        avg_vol = sum(volumes[-20:]) / 20
        current_vol = volumes[-1]

        if avg_vol == 0:
            result.reasons.append("Average volume is zero — scored 0")
            return 0.0

        ratio = current_vol / avg_vol
        result.volume_ratio = round(ratio, 2)

        if ratio >= self.VOL_CONFIRM_RATIO:
            result.reasons.append(
                f"Volume confirmed: {ratio:.2f}x avg (>= {self.VOL_CONFIRM_RATIO}x)"
            )
            return 15.0

        if ratio >= 1.0:
            result.reasons.append(f"Volume at average: {ratio:.2f}x avg")
            return 8.0

        result.reasons.append(f"Volume below average: {ratio:.2f}x avg")
        return 0.0

    def _score_volatility(
        self,
        vix: Optional[float],
        result: ConfidenceBreakdown,
    ) -> float:
        """
        Volatility Regime (India VIX) — up to 15 points.

        VIX < 12  (calm)     → 15 pts
        VIX 12–18 (moderate) → 10 pts
        VIX 18–25 (elevated) →  5 pts
        VIX > 25  (panic)    →  0 pts

        If VIX is unavailable, assume moderate regime (10 pts).
        """
        if vix is None:
            vix = 15.0  # default assumption: moderate
            result.reasons.append("VIX unavailable — assumed moderate (15)")

        result.vix = vix

        if vix < self.VIX_LOW:
            result.reasons.append(f"VIX {vix:.1f} — calm regime (< {self.VIX_LOW})")
            return 15.0
        if vix < self.VIX_MED:
            result.reasons.append(f"VIX {vix:.1f} — moderate regime")
            return 10.0
        if vix < self.VIX_HIGH:
            result.reasons.append(f"VIX {vix:.1f} — elevated regime")
            return 5.0

        result.reasons.append(f"VIX {vix:.1f} — panic regime (>= {self.VIX_HIGH})")
        return 0.0

    def _score_support_resistance(
        self,
        closes: list[float],
        highs: list[float],
        lows: list[float],
        result: ConfidenceBreakdown,
    ) -> float:
        """
        Support / Resistance Proximity — up to 10 points.

        Uses a simple pivot-point approach on the last 20 bars:
        - Support  = lowest low of last 20 bars
        - Resistance = highest high of last 20 bars
        - Current close relative to that range

        LONG:  price near support (lower 30%)  → 10 pts
        SHORT: price near resistance (upper 30%) → 10 pts
        Middle zone                              →  5 pts
        Opposing zone                            →  0 pts
        """
        lookback = 20
        if len(closes) < lookback:
            result.reasons.append("Insufficient data for S/R analysis")
            return 0.0

        recent_highs = highs[-lookback:]
        recent_lows = lows[-lookback:]
        resistance = max(recent_highs)
        support = min(recent_lows)
        price = closes[-1]

        if resistance == support:
            result.reasons.append("Flat range — S/R not meaningful")
            return 5.0

        # Position in range: 0 = at support, 1 = at resistance
        position = (price - support) / (resistance - support)
        direction = result.direction

        if direction == "BULLISH":
            if position <= 0.30:
                result.reasons.append(
                    f"Price near support ({position:.0%} of range) — bullish"
                )
                return 10.0
            if position <= 0.70:
                result.reasons.append(f"Price in mid-range ({position:.0%})")
                return 5.0
            result.reasons.append(
                f"Price near resistance ({position:.0%}) — risky for longs"
            )
            return 0.0

        if direction == "BEARISH":
            if position >= 0.70:
                result.reasons.append(
                    f"Price near resistance ({position:.0%}) — bearish"
                )
                return 10.0
            if position >= 0.30:
                result.reasons.append(f"Price in mid-range ({position:.0%})")
                return 5.0
            result.reasons.append(
                f"Price near support ({position:.0%}) — risky for shorts"
            )
            return 0.0

        result.reasons.append(f"Neutral direction — S/R position {position:.0%}")
        return 5.0
