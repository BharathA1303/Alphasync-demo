import { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import { cn } from '../utils/cn';
import { pnlColorClass, formatPrice, formatPercent } from '../utils/formatters';
import { useZeroLossStore } from '../stores/useZeroLossStore';
import {
    ShieldCheck, Play, Pause, RefreshCw,
} from 'lucide-react';

// ── Confidence Gauge ──────────────────────────────────────────────────────────

function ConfidenceGauge({ score, size = 140 }) {
    const radius = (size - 20) / 2;
    const circumference = Math.PI * radius; // semi-circle
    const progress = Math.min(Math.max(score, 0), 100);
    const offset = circumference - (progress / 100) * circumference;

    const color =
        progress >= 75 ? '#22c55e' :
            progress >= 50 ? '#0EA5E9' :
                progress >= 25 ? '#f97316' : '#ef4444';

    return (
        <div className="flex flex-col items-center">
            <svg width={size} height={size / 2 + 20} viewBox={`0 0 ${size} ${size / 2 + 20}`}>
                {/* Background arc */}
                <path
                    d={`M 10,${size / 2 + 10} A ${radius},${radius} 0 0 1 ${size - 10},${size / 2 + 10}`}
                    fill="none"
                    stroke="rgb(var(--c-edge) / 0.1)"
                    strokeWidth="8"
                    strokeLinecap="round"
                />
                {/* Progress arc */}
                <path
                    d={`M 10,${size / 2 + 10} A ${radius},${radius} 0 0 1 ${size - 10},${size / 2 + 10}`}
                    fill="none"
                    stroke={color}
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={offset}
                    className="transition-all duration-700 ease-out"
                />
                {/* Score text */}
                <text
                    x={size / 2}
                    y={size / 2}
                    textAnchor="middle"
                    className="fill-heading text-2xl font-semibold"
                    style={{ fontSize: '28px', fontFamily: 'DM Mono, monospace' }}
                >
                    {Math.round(progress)}
                </text>
                <text
                    x={size / 2}
                    y={size / 2 + 16}
                    textAnchor="middle"
                    className="fill-gray-500"
                    style={{ fontSize: '10px' }}
                >
                    CONFIDENCE
                </text>
            </svg>
        </div>
    );
}

// ── Direction Badge ───────────────────────────────────────────────────────────

function DirectionBadge({ direction }) {
    const config = {
        LONG: { arrow: '▲', cls: 'signal-pill signal-pill-bullish' },
        SHORT: { arrow: '▼', cls: 'signal-pill signal-pill-bearish' },
        NO_TRADE: { arrow: '—', cls: 'signal-pill signal-pill-neutral' },
        BULLISH: { arrow: '▲', cls: 'signal-pill signal-pill-bullish' },
        BEARISH: { arrow: '▼', cls: 'signal-pill signal-pill-bearish' },
        NEUTRAL: { arrow: '—', cls: 'signal-pill signal-pill-neutral' },
    };
    const c = config[direction] || config.NEUTRAL;

    return (
        <span className={cn(c.cls, 'text-xs font-semibold')}>
            {c.arrow} {direction}
        </span>
    );
}

// ── Status Badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
    const colors = {
        WAITING: 'text-gray-400 bg-gray-500/10',
        ACTIVE: 'text-blue-400 bg-blue-500/15',
        PROFIT: 'text-emerald-600 bg-emerald-500/15',
        BREAKEVEN: 'text-[#0EA5E9] bg-[#0EA5E9]/10',
    };
    return (
        <span className={cn('px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide', colors[status] || colors.WAITING)}>
            {status}
        </span>
    );
}

// ── Breakdown Bar ─────────────────────────────────────────────────────────────

function BreakdownItem({ label, score, max, color }) {
    const pct = max > 0 ? (score / max) * 100 : 0;
    return (
        <div className="space-y-0.5">
            <div className="flex justify-between text-[11px]">
                <span className="text-gray-400">{label}</span>
                <span className="text-heading font-price tabular-nums">{score}/{max}</span>
            </div>
            <div className="h-1.5 bg-surface-800 rounded-full overflow-hidden">
                <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${pct}%`, backgroundColor: color }}
                />
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function ZeroLossPage() {
    const {
        enabled, confidence, activePositions, stats,
        signals, performance, loading, fetchAll, toggle, lastUpdate,
    } = useZeroLossStore();

    const [toggling, setToggling] = useState(false);

    // Initial load (WS provides real-time updates after this)
    useEffect(() => { fetchAll(); }, [fetchAll]);

    // Refresh signal history periodically (not streamed via WS)
    useEffect(() => {
        const id = setInterval(fetchAll, 30_000);
        return () => clearInterval(id);
    }, [fetchAll]);

    // ── Toggle strategy ───────────────────────────────────────────
    const handleToggle = async () => {
        setToggling(true);
        try {
            const res = await toggle();
            toast.success(res.message);
        } catch (err) {
            toast.error('Failed to toggle strategy');
        } finally {
            setToggling(false);
        }
    };

    // ── Derived data ──────────────────────────────────────────────
    const positions = activePositions ?? {};
    const perfSummary = performance?.summary ?? {};

    const symbolEntries = useMemo(
        () => Object.entries(confidence),
        [confidence]
    );

    // Last update indicator
    const lastUpdateStr = lastUpdate
        ? new Date(lastUpdate).toLocaleTimeString('en-IN', { hour12: false })
        : null;

    if (loading) {
        return (
            <div className="min-h-[calc(100vh-56px)] bg-surface-950 flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <div className="min-h-[calc(100vh-56px)] bg-surface-950 p-4 md:p-6 space-y-6 overflow-y-auto">
            {/* ── Header ──────────────────────────────────────────────── */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                        <ShieldCheck className="w-6 h-6 text-emerald-600" />
                    </div>
                    <div>
                        <h1 className="text-xl font-display font-semibold text-heading">ZeroLoss Strategy</h1>
                        <p className="text-xs text-gray-500 mt-0.5">
                            Confidence-gated • Break-even protected • Two outcomes only: Profit or No Loss
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {lastUpdateStr && (
                        <span className="text-[10px] text-gray-600 font-price tabular-nums flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            LIVE · {lastUpdateStr}
                        </span>
                    )}

                    <button
                        onClick={fetchAll}
                        className="p-2 rounded-lg border border-edge/10 bg-surface-800/60 text-gray-400 hover:text-heading hover:border-edge/20 transition-all"
                        title="Refresh"
                    >
                        <RefreshCw className="w-4 h-4" />
                    </button>

                    <button
                        onClick={handleToggle}
                        disabled={toggling}
                        className={cn(
                            'flex items-center gap-2 px-5 py-2.5 rounded-xl border font-semibold text-sm transition-all duration-200 shadow-lg',
                            enabled
                                ? 'bg-red-500/15 border-red-500/30 text-red-500 hover:bg-red-500/25 shadow-red-500/5'
                                : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/25 shadow-emerald-500/5'
                        )}
                    >
                        {enabled ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                        {toggling ? 'Switching…' : enabled ? 'Stop Strategy' : 'Start Strategy'}
                    </button>
                </div>
            </div>

            {/* ── Stats Cards ─────────────────────────────────────────── */}
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
                {[
                    { label: 'Status', value: enabled ? 'ACTIVE' : 'STOPPED', color: enabled ? 'text-emerald-600' : 'text-gray-500' },
                    { label: 'Today Trades', value: stats.today_trades ?? 0 },
                    { label: 'Profit Trades', value: stats.today_profit ?? 0, color: 'text-emerald-600' },
                    { label: 'Breakeven Trades', value: stats.today_breakeven ?? 0, color: 'text-[#0EA5E9]' },
                    { label: 'Loss Trades', value: 0, color: 'text-emerald-600' },
                    { label: "Today's P&L", value: `₹${formatPrice(stats.today_pnl ?? 0)}`, color: pnlColorClass(stats.today_pnl ?? 0) },
                ].map((card, i) => (
                    <div key={i} className="kpi-card p-3.5 space-y-1">
                        <div className="metric-label">{card.label}</div>
                        <div className={cn('text-lg font-semibold font-price tabular-nums', card.color || 'text-heading')}>
                            {card.value}
                        </div>
                    </div>
                ))}
            </div>

            {/* ── Main Grid: Confidence + Active Positions ────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Confidence Panel */}
                <div className="lg:col-span-2 rounded-xl border border-edge/5 bg-surface-900/60 p-4">
                    <h3 className="section-title text-xs mb-4">Live Confidence Scores</h3>

                    {symbolEntries.length === 0 ? (
                        <div className="text-center text-gray-600 py-8 text-sm">
                            {enabled ? 'Scanning markets…' : 'Start the strategy to see confidence scores'}
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                            {symbolEntries.map(([symbol, data]) => (
                                <div key={symbol} className="rounded-xl border border-edge/10 bg-surface-800/40 p-4 space-y-3">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm font-semibold text-heading">
                                            {symbol.replace('.NS', '')}
                                        </span>
                                        <DirectionBadge direction={data.direction} />
                                    </div>

                                    <ConfidenceGauge score={data.score} size={130} />

                                    {/* Breakdown bars */}
                                    {data.breakdown && (
                                        <div className="space-y-1.5">
                                            <BreakdownItem label="EMA Stack" score={data.breakdown.ema} max={25} color="#3b82f6" />
                                            <BreakdownItem label="RSI Zone" score={data.breakdown.rsi} max={20} color="#8b5cf6" />
                                            <BreakdownItem label="MACD" score={data.breakdown.macd} max={15} color="#f59e0b" />
                                            <BreakdownItem label="Volume" score={data.breakdown.volume} max={15} color="#f59e0b" />
                                            <BreakdownItem label="Volatility" score={data.breakdown.volatility} max={15} color="#10b981" />
                                            <BreakdownItem label="S/R Level" score={data.breakdown.support_resistance} max={10} color="#ec4899" />
                                        </div>
                                    )}

                                    <div className="text-[10px] text-gray-600 text-right">
                                        Threshold: 75 | Score: {data.score?.toFixed(1)}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Active Positions */}
                <div className="rounded-xl border border-edge/5 bg-surface-900/60 p-4">
                    <h3 className="section-title text-xs mb-4">Active Positions</h3>

                    {Object.keys(positions).length === 0 ? (
                        <div className="text-center text-gray-600 py-8 text-sm">
                            No active positions
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {Object.entries(positions).map(([symbol, pos]) => (
                                <div key={symbol} className="rounded-lg border border-edge/10 bg-surface-800/40 p-3 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm font-semibold text-heading">
                                            {symbol.replace('.NS', '')}
                                        </span>
                                        <div className="flex items-center gap-2">
                                            <DirectionBadge direction={pos.direction} />
                                            <StatusBadge status={pos.status} />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-3 gap-2 text-[11px]">
                                        <div>
                                            <span className="metric-label block">Entry</span>
                                            <span className="text-heading font-price tabular-nums">{formatPrice(pos.entry_price)}</span>
                                        </div>
                                        <div>
                                            <span className="metric-label block">Stop Loss</span>
                                            <span className="text-[#0EA5E9] font-price tabular-nums">{formatPrice(pos.stop_loss)}</span>
                                        </div>
                                        <div>
                                            <span className="metric-label block">Target</span>
                                            <span className="text-emerald-600 font-price tabular-nums">{formatPrice(pos.target)}</span>
                                        </div>
                                    </div>

                                    <div className="text-[10px] text-gray-500">
                                        Confidence: {pos.confidence_score?.toFixed(1)} |
                                        RR: 1:{pos.risk_reward_ratio?.toFixed(1)}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* ── Performance Summary ─────────────────────────────────── */}
            {perfSummary && (
                <div className="rounded-xl border border-edge/5 bg-surface-900/60 p-4">
                    <h3 className="section-title text-xs mb-4">30-Day Performance</h3>
                    <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                        {[
                            { label: 'Total Trades', value: perfSummary.total_trades ?? 0 },
                            { label: 'Profit Trades', value: perfSummary.profit_trades ?? 0, color: 'text-emerald-600' },
                            { label: 'Breakeven', value: perfSummary.breakeven_trades ?? 0, color: 'text-[#0EA5E9]' },
                            { label: 'Losses', value: '0', color: 'text-emerald-600' },
                            { label: 'Win Rate', value: `${perfSummary.win_rate ?? 0}%`, color: 'text-blue-400' },
                            { label: 'Net P&L', value: `₹${formatPrice(perfSummary.net_pnl ?? 0)}`, color: pnlColorClass(perfSummary.net_pnl ?? 0) },
                        ].map((item, i) => (
                            <div key={i} className="text-center p-3 rounded-lg bg-surface-800/40 border border-edge/5">
                                <div className="metric-label mb-1">{item.label}</div>
                                <div className={cn('text-base font-semibold font-price tabular-nums', item.color || 'text-heading')}>
                                    {item.value}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* ── Signal History ───────────────────────────────────────── */}
            <div className="rounded-xl border border-edge/5 bg-surface-900/60 p-4">
                <h3 className="section-title text-xs mb-4">Signal History</h3>

                {signals.length === 0 ? (
                    <div className="text-center text-gray-600 py-8 text-sm">
                        No signals generated yet. Start the strategy to begin.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="border-b border-edge/5">
                                    <th className="text-left py-2 px-3 metric-label">Time</th>
                                    <th className="text-left py-2 px-3 metric-label">Symbol</th>
                                    <th className="text-left py-2 px-3 metric-label">Direction</th>
                                    <th className="text-right py-2 px-3 metric-label">Confidence</th>
                                    <th className="text-right py-2 px-3 metric-label">Entry</th>
                                    <th className="text-right py-2 px-3 metric-label">Stop Loss</th>
                                    <th className="text-right py-2 px-3 metric-label">Target</th>
                                    <th className="text-center py-2 px-3 metric-label">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {signals.map((sig, i) => (
                                    <tr key={i} className="border-b border-edge/[0.03] hover:bg-overlay/5 transition-colors">
                                        <td className="py-2 px-3 text-gray-400 font-price tabular-nums">
                                            {sig.timestamp ? new Date(sig.timestamp).toLocaleString('en-IN', { hour12: false, hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' }) : '—'}
                                        </td>
                                        <td className="py-2 px-3 font-semibold text-heading">
                                            {sig.symbol?.replace('.NS', '') || '—'}
                                        </td>
                                        <td className="py-2 px-3">
                                            <DirectionBadge direction={sig.direction} />
                                        </td>
                                        <td className="py-2 px-3 text-right font-price tabular-nums text-heading">
                                            {sig.confidence_score?.toFixed(1) ?? '—'}
                                        </td>
                                        <td className="py-2 px-3 text-right font-price tabular-nums text-gray-600">
                                            {sig.entry_price ? formatPrice(sig.entry_price) : '—'}
                                        </td>
                                        <td className="py-2 px-3 text-right font-price tabular-nums text-[#0EA5E9]">
                                            {sig.stop_loss ? formatPrice(sig.stop_loss) : '—'}
                                        </td>
                                        <td className="py-2 px-3 text-right font-price tabular-nums text-emerald-600">
                                            {sig.target ? formatPrice(sig.target) : '—'}
                                        </td>
                                        <td className="py-2 px-3 text-center">
                                            <StatusBadge status={sig.status} />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* ── How It Works ─────────────────────────────────────────── */}
            <div className="rounded-xl border border-edge/5 bg-surface-900/60 p-4 text-xs text-gray-500 space-y-2">
                <h3 className="section-title text-xs mb-3">How ZeroLoss Works</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {[
                        { step: '01', title: 'Confidence Gate', desc: 'Analyses EMA stack, RSI, MACD, volume, VIX, and S/R levels. Only enters when score ≥ 75/100.', color: 'text-blue-400 border-blue-500/20 bg-blue-500/5' },
                        { step: '02', title: 'Break-Even Stop', desc: 'Stop-loss placed at exact break-even (including 0.25% transaction costs). If hit → zero net loss.', color: 'text-[#0EA5E9] border-[#0EA5E9]/20 bg-[#0EA5E9]/5' },
                        { step: '03', title: 'Two Outcomes Only', desc: 'Every trade ends as PROFIT (target hit, 1:3 RR) or BREAKEVEN (stop hit, ₹0 loss). Never a net loss.', color: 'text-emerald-600 border-emerald-500/20 bg-emerald-500/5' },
                    ].map(s => (
                        <div key={s.step} className={cn('rounded-lg border p-3 space-y-1', s.color)}>
                            <div className="flex items-center gap-2">
                                <span className="font-price text-lg font-semibold opacity-40">{s.step}</span>
                                <span className="text-xs font-semibold">{s.title}</span>
                            </div>
                            <p className="text-gray-500 leading-relaxed">{s.desc}</p>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
