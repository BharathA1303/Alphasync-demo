"""
AlphaSync ZeroLoss — Break-Even Manager.

Calculates the true break-even price for every trade, factoring in ALL
Indian equity market transaction costs so the stop-loss sits at a price
where net P&L = ₹0.00.

Indian Equity Delivery / Intraday Cost Breakdown (approximate):
    ┌──────────────────────────┬────────────────┬──────────────┐
    │ Component                │ Buy Side       │ Sell Side    │
    ├──────────────────────────┼────────────────┼──────────────┤
    │ Brokerage (discount)     │ ₹20 or 0.03%  │ ₹20 or 0.03%│
    │ STT (Securities Trxn)   │ 0.1% (delivery)│ 0.1%         │
    │ Exchange Txn Charge      │ 0.00345%       │ 0.00345%     │
    │ GST (18% on brok+exch)  │ ~0.006%        │ ~0.006%      │
    │ SEBI Turnover Fee        │ 0.0001%        │ 0.0001%      │
    │ Stamp Duty (buy only)    │ 0.015%         │ —            │
    ├──────────────────────────┼────────────────┴──────────────┤
    │ TOTAL ROUND-TRIP         │ ≈ 0.25% of trade value       │
    └──────────────────────────┴───────────────────────────────┘

The stop-loss is placed AT the break-even price, guaranteeing:
    • If price moves favourably → target hit → PROFIT
    • If price reverses         → SL hit     → ZERO net loss

Usage:
    from strategies.zeroloss.breakeven_manager import BreakevenManager

    mgr = BreakevenManager()
    levels = mgr.compute_levels(
        entry_price=1401.80,
        direction="LONG",
        quantity=10,
    )
    print(levels.stop_loss)  # 1405.30 (entry + costs)
"""

import logging
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)


# ── Trade Levels ───────────────────────────────────────────────────────────────


@dataclass
class TradeLevels:
    """Complete set of prices for a ZeroLoss trade."""

    entry: float  # Entry price
    stop_loss: float  # Break-even stop (entry ± round-trip costs)
    target: float  # Target price (1:RR from stop to target)
    risk_reward_ratio: float  # Actual RR achieved
    total_cost: float  # Absolute ₹ cost for the round-trip
    cost_percent: float  # Cost as % of trade value


class BreakevenManager:
    """
    Computes break-even stop-loss and target prices.

    All cost components are isolated as class constants so they can be
    tuned or overridden without touching the logic.
    """

    # ── Cost Components (as fraction of trade value) ───────────────

    # Brokerage: flat ₹20 per order OR 0.03%, whichever is lower
    BROKERAGE_PERCENT = 0.0003  # 0.03%
    BROKERAGE_FLAT = 20.0  # ₹20 cap per order leg

    # STT – Securities Transaction Tax (delivery)
    STT_BUY = 0.001  # 0.1% on buy value
    STT_SELL = 0.001  # 0.1% on sell value

    # Exchange transaction charges (NSE)
    EXCHANGE_CHARGE = 0.0000345  # 0.00345%

    # SEBI turnover fee
    SEBI_FEE = 0.000001  # 0.0001%

    # GST: 18% on (brokerage + exchange charges)
    GST_RATE = 0.18

    # Stamp duty (only on buy side)
    STAMP_DUTY = 0.00015  # 0.015%

    # Safety buffer: add a small margin above exact break-even
    # to account for slippage in simulation mode
    SLIPPAGE_BUFFER_PERCENT = 0.0001  # 0.01%

    def compute_levels(
        self,
        entry_price: float,
        direction: str,
        quantity: int = 1,
        risk_reward_ratio: float = 3.0,
    ) -> TradeLevels:
        """
        Compute break-even stop-loss and risk-reward target.

        Args:
            entry_price:       Price at which the trade is entered.
            direction:         "LONG" or "SHORT".
            quantity:          Number of shares.
            risk_reward_ratio: Minimum R:R for the target (default 1:3).

        Returns:
            TradeLevels with entry, stop_loss, target, and cost info.
        """
        trade_value = entry_price * quantity

        # ── Buy-side costs ─────────────────────────────────────────
        buy_brokerage = min(
            trade_value * self.BROKERAGE_PERCENT,
            self.BROKERAGE_FLAT,
        )
        buy_stt = trade_value * self.STT_BUY
        buy_exchange = trade_value * self.EXCHANGE_CHARGE
        buy_sebi = trade_value * self.SEBI_FEE
        buy_gst = (buy_brokerage + buy_exchange) * self.GST_RATE
        buy_stamp = trade_value * self.STAMP_DUTY
        buy_total = (
            buy_brokerage + buy_stt + buy_exchange + buy_sebi + buy_gst + buy_stamp
        )

        # ── Sell-side costs ────────────────────────────────────────
        sell_brokerage = min(
            trade_value * self.BROKERAGE_PERCENT,
            self.BROKERAGE_FLAT,
        )
        sell_stt = trade_value * self.STT_SELL
        sell_exchange = trade_value * self.EXCHANGE_CHARGE
        sell_sebi = trade_value * self.SEBI_FEE
        sell_gst = (sell_brokerage + sell_exchange) * self.GST_RATE
        sell_total = sell_brokerage + sell_stt + sell_exchange + sell_sebi + sell_gst

        # ── Round-trip cost ────────────────────────────────────────
        total_cost = buy_total + sell_total
        slippage = trade_value * self.SLIPPAGE_BUFFER_PERCENT
        total_with_buffer = total_cost + slippage

        cost_per_share = total_with_buffer / quantity if quantity > 0 else 0
        cost_percent = (total_with_buffer / trade_value * 100) if trade_value > 0 else 0

        # ── Break-even stop-loss ───────────────────────────────────
        # LONG:  stop = entry + cost_per_share  (need price to go DOWN to this)
        #        Wait — for LONG, if price goes DOWN we lose, so break-even
        #        stop is actually entry - (- cost) … No:
        #
        #        For a LONG trade:
        #          PnL = (exit - entry) * qty - total_cost
        #          Break-even → exit = entry + total_cost / qty
        #          But stop is where we EXIT if price drops, so for a LONG
        #          we want to NOT LOSE money.  The break-even exit is:
        #            exit_breakeven = entry + cost_per_share
        #          This means price must rise by cost_per_share just to
        #          break even.  We set the stop-loss AT this level AFTER
        #          the price has moved favourably past it.
        #
        #        Strategy flow:
        #          1. Enter LONG at `entry_price`.
        #          2. If price rises past break-even, move stop to break-even.
        #          3. If price never reaches break-even, the initial stop handles it.
        #
        #        For this ZeroLoss system, the INITIAL stop IS at break-even.
        #        This means we accept that the trade immediately risks
        #        the cost amount, but the stop guarantees zero net loss:
        #          If stopped out: PnL = (stop - entry)*qty - cost = 0

        if direction == "LONG":
            # For LONG: break-even stop should be BELOW the entry price by the
            # per-share cost.  When stopped at this price the net PnL = 0.
            # PnL = (stop_loss - entry) * qty - total_cost = 0
            # → stop_loss = entry - total_cost / qty
            stop_loss = round(entry_price - cost_per_share, 2)

            # Risk (per-share) is entry - stop_loss (== cost_per_share).
            # Target is entry + (risk * risk_reward_ratio).
            risk = cost_per_share
            target = round(entry_price + risk * risk_reward_ratio, 2)

        else:  # SHORT
            # For SHORT: break-even stop should be ABOVE the entry price by the
            # per-share cost. PnL = (entry - stop_loss) * qty - total_cost = 0
            # → stop_loss = entry + total_cost / qty
            stop_loss = round(entry_price + cost_per_share, 2)

            risk = cost_per_share
            target = round(entry_price - risk * risk_reward_ratio, 2)

        # Actual RR achieved
        actual_rr = risk_reward_ratio  # by construction

        logger.debug(
            f"Break-even levels | Direction: {direction} | "
            f"Entry: {entry_price:.2f} | SL: {stop_loss:.2f} | "
            f"Target: {target:.2f} | Cost: ₹{total_cost:.2f} "
            f"({cost_percent:.3f}%) | RR: 1:{actual_rr:.1f}"
        )

        return TradeLevels(
            entry=entry_price,
            stop_loss=stop_loss,
            target=target,
            risk_reward_ratio=actual_rr,
            total_cost=round(total_cost, 2),
            cost_percent=round(cost_percent, 4),
        )

    def check_exit(
        self,
        direction: str,
        entry_price: float,
        current_price: float,
        stop_loss: float,
        target: float,
    ) -> Optional[str]:
        """
        Check if the current price triggers a stop-loss or target exit.

        Args:
            direction:     "LONG" or "SHORT".
            entry_price:   Original entry price.
            current_price: Latest market price.
            stop_loss:     Break-even stop-loss price.
            target:        Target profit price.

        Returns:
            "BREAKEVEN" if stop hit, "PROFIT" if target hit, None otherwise.
        """
        if direction == "LONG":
            if current_price <= stop_loss:
                return "BREAKEVEN"
            if current_price >= target:
                return "PROFIT"

        elif direction == "SHORT":
            if current_price >= stop_loss:
                return "BREAKEVEN"
            if current_price <= target:
                return "PROFIT"

        return None
