import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../stores/useAuthStore';
import { usePortfolioStore } from '../store/usePortfolioStore';
import { useMarketStore } from '../store/useMarketStore';
import api from '../services/api';
import {
    TrendingUp, TrendingDown, IndianRupee,
    BarChart3, ArrowRight, Zap, Briefcase,
    ShieldCheck,
} from 'lucide-react';
import { formatCurrency, formatPrice, formatPercent, pnlColorClass } from '../utils/formatters';
import { Skeleton } from '../components/ui';
import { cn } from '../utils/cn';

/* ── Mini SVG Sparkline ──────────────────────────────────────────────────────── */
function MiniSparkline({ data = [], color = 'var(--bullish)', width = 80, height = 24 }) {
    if (!data || data.length < 2) return null;
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const points = data.map((v, i) => {
        const x = (i / (data.length - 1)) * width;
        const y = height - ((v - min) / range) * height;
        return `${x},${y}`;
    }).join(' ');

    return (
        <svg width={width} height={height} className="flex-shrink-0 opacity-60" aria-hidden="true">
            <polyline
                fill="none"
                stroke={color}
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={points}
            />
        </svg>
    );
}

export default function DashboardPage() {
    const { user } = useAuthStore();
    const [portfolio, setPortfolio] = useState(null);
    const [indices, setIndices] = useState([]);
    const [holdings, setHoldings] = useState([]);
    const [recentOrders, setRecentOrders] = useState([]);
    const [loading, setLoading] = useState(true);

    // Real-time portfolio data from store (updated by WebSocket + global polling hook)
    const storeSummary = usePortfolioStore((s) => s.summary);
    const storeHoldings = usePortfolioStore((s) => s.holdings);
    const storePnl = usePortfolioStore((s) => s.pnl);
    const liveQuotes = useMarketStore((s) => s.symbols);

    useEffect(() => {
        const load = async () => {
            try {
                const [pRes, iRes, hRes, oRes] = await Promise.allSettled([
                    api.get('/portfolio'),
                    api.get('/market/indices'),
                    api.get('/portfolio/holdings'),
                    api.get('/orders'),
                ]);
                if (pRes.status === 'fulfilled') setPortfolio(pRes.value.data);
                if (iRes.status === 'fulfilled') setIndices(iRes.value.data.indices || []);
                if (hRes.status === 'fulfilled') setHoldings(hRes.value.data.holdings || []);
                if (oRes.status === 'fulfilled') setRecentOrders((oRes.value.data.orders || []).slice(0, 5));
            } catch { /* ignore */ }
            setLoading(false);
        };
        load();
    }, []);

    // Compute live holdings with real-time P&L from WebSocket quotes
    const liveHoldings = useMemo(() => {
        const baseHoldings = storeHoldings?.length > 0 ? storeHoldings : holdings;
        return baseHoldings.map((h) => {
            const symbol = h?.symbol;
            if (!symbol) return h;
            const wsQuote = liveQuotes[symbol] || liveQuotes[symbol.replace('.NS', '')] || liveQuotes[`${symbol}.NS`];
            const livePrice = Number(wsQuote?.price ?? wsQuote?.lp ?? wsQuote?.ltp ?? wsQuote?.last_price);
            if (!Number.isFinite(livePrice) || livePrice <= 0) return h;
            const quantity = Number(h.quantity ?? 0);
            const avgPrice = Number(h.avg_price ?? 0);
            const investedValue = avgPrice * quantity;
            const currentValue = livePrice * quantity;
            const pnl = currentValue - investedValue;
            const pnlPercent = investedValue > 0 ? (pnl / investedValue) * 100 : 0;
            return { ...h, current_price: livePrice, current_value: currentValue, pnl, pnl_percent: pnlPercent };
        });
    }, [storeHoldings, holdings, liveQuotes]);

    // Compute live totals from holdings with real-time prices
    const liveTotals = useMemo(() => {
        const invested = liveHoldings.reduce((sum, h) => {
            const qty = Number(h.quantity ?? 0);
            const avg = Number(h.avg_price ?? 0);
            return sum + avg * qty;
        }, 0);
        const current = liveHoldings.reduce((sum, h) => sum + Number(h.current_value ?? 0), 0);
        const unrealized = liveHoldings.reduce((sum, h) => sum + Number(h.pnl ?? 0), 0);
        return { invested, current, unrealized };
    }, [liveHoldings]);

    if (loading) {
        return (
            <div className="p-4 lg:p-6 space-y-6">
                <Skeleton variant="text" className="h-8 w-48" />
                <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
                    {Array.from({ length: 5 }).map((_, i) => (
                        <div key={i} className={cn('kpi-card', i === 4 && 'col-span-2')}>
                            <Skeleton variant="text" className="h-3 w-20" />
                            <Skeleton variant="text" className="h-7 w-28 mt-2" />
                        </div>
                    ))}
                </div>
                <Skeleton variant="chart" className="h-40" />
                <Skeleton variant="table-row" count={4} />
            </div>
        );
    }

    // Prefer real-time computed values, fallback to store summary, then static API data
    const totalInvested = liveTotals.invested || storeSummary?.total_invested || portfolio?.total_invested || 0;
    const currentValue = liveTotals.current || storeSummary?.current_value || portfolio?.current_value || 0;
    const availableCash = storeSummary?.available_capital || portfolio?.available_capital || 0;
    const totalCapital = availableCash + currentValue;
    const totalPnl = liveTotals.unrealized || storePnl?.total || storeSummary?.total_pnl || portfolio?.total_pnl || 0;
    const totalPnlPct = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;

    return (
        <div className="p-4 lg:p-6 space-y-5 animate-fade-in">
            {/* ── Welcome Header ───────────────────────────────────────── */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-display font-semibold text-heading">
                        Welcome, {user?.full_name?.split(' ')[0] || user?.username || 'Trader'}
                    </h1>
                    <p className="text-gray-500 text-sm mt-0.5">Here&apos;s your portfolio overview</p>
                </div>
                <Link to="/terminal" className="btn-primary text-sm hidden sm:inline-flex items-center gap-2" aria-label="Open trading terminal">
                    Trade Now <ArrowRight className="w-4 h-4" />
                </Link>
            </div>

            {/* ── KPI Bar — P&L card 2x wider ──────────────────────────── */}
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
                {/* Regular metrics */}
                {[
                    { label: 'TOTAL CAPITAL', value: formatCurrency(totalCapital), icon: IndianRupee, iconColor: 'text-primary-600' },
                    { label: 'AVAILABLE CASH', value: formatCurrency(availableCash), icon: IndianRupee, iconColor: 'text-accent-cyan' },
                    { label: 'INVESTED', value: formatCurrency(totalInvested), icon: BarChart3, iconColor: 'text-[#0EA5E9]' },
                    { label: 'CURRENT VALUE', value: formatCurrency(currentValue), icon: TrendingUp, iconColor: 'text-accent-emerald' },
                ].map(({ label, value, icon: Icon, iconColor }) => (
                    <div key={label} className="kpi-card">
                        <div className="flex items-center justify-between">
                            <span className="metric-label">{label}</span>
                            <Icon className={cn('w-4 h-4', iconColor)} />
                        </div>
                        <span className="text-lg font-price font-semibold text-heading tabular-nums mt-1">
                            {value}
                        </span>
                    </div>
                ))}

                {/* P&L Card — 2x wide, color-coded background */}
                <div className={cn(
                    'kpi-card-highlight',
                    totalPnl >= 0
                        ? 'bg-gradient-to-br from-green-500/[0.07] to-surface-900/60 border-green-500/10'
                        : 'bg-gradient-to-br from-red-500/[0.07] to-surface-900/60 border-red-500/10'
                )}>
                    <div className="flex items-center justify-between">
                        <span className="metric-label">TOTAL P&L</span>
                        {totalPnl >= 0
                            ? <TrendingUp className="w-5 h-5 text-profit" />
                            : <TrendingDown className="w-5 h-5 text-loss" />
                        }
                    </div>
                    <div className="flex items-end gap-3 mt-1">
                        <span className={cn('text-3xl font-price font-semibold tabular-nums', pnlColorClass(totalPnl))}>
                            {totalPnl >= 0 ? '+' : ''}{formatCurrency(totalPnl)}
                        </span>
                        <span className={cn('text-sm font-price mb-1 tabular-nums', pnlColorClass(totalPnl))}>
                            {totalPnl >= 0 ? '▲' : '▼'} {formatPercent(totalPnlPct)}
                        </span>
                    </div>
                </div>
            </div>

            {/* ── Row: Market Indices Grid + Quick Actions Dock ─────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
                {/* Market Indices — 2x2 grid */}
                <div className="lg:col-span-3 rounded-xl border border-edge/5 bg-surface-900/60 p-5">
                    <h2 className="section-title text-sm text-heading mb-4">Market Indices</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {indices.length > 0 ? indices.slice(0, 4).map((idx, i) => {
                            const isUp = (idx.change ?? 0) >= 0;
                            return (
                                <div key={i} className="flex items-center justify-between p-3.5 rounded-lg bg-surface-800/40 border border-edge/[0.04] hover:border-edge/10 transition-colors">
                                    <div className="flex-1 min-w-0">
                                        <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">{idx.name}</div>
                                        <div className="text-xl font-price font-semibold text-heading tabular-nums mt-0.5">
                                            {Number(idx.price).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                        </div>
                                    </div>
                                    <div className={cn('text-right flex flex-col items-end gap-0.5', pnlColorClass(idx.change))}>
                                        <div className="flex items-center gap-1 text-sm font-price font-semibold tabular-nums">
                                            {isUp ? '▲' : '▼'}
                                            {idx.change > 0 ? '+' : ''}{formatPrice(idx.change)}
                                        </div>
                                        <div className="text-xs font-price tabular-nums opacity-70">{formatPercent(idx.change_percent)}</div>
                                        <MiniSparkline
                                            data={[100, 102, 99, 101, 98, 103, 100 + (idx.change ?? 0) / 10]}
                                            color={isUp ? 'var(--bullish)' : 'var(--bearish)'}
                                            width={56}
                                            height={18}
                                        />
                                    </div>
                                </div>
                            );
                        }) : (
                            <div className="col-span-2 text-center py-8 text-gray-600">
                                <BarChart3 className="w-8 h-8 mx-auto mb-2 opacity-40" />
                                <p className="text-sm">Market data loading...</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Quick Actions — vertical dock */}
                <div className="lg:col-span-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#0f172a] p-5">
                    <h2 className="section-title text-sm text-heading mb-4">Quick Actions</h2>
                    <div className="space-y-2">
                        {[
                            { to: '/terminal', icon: BarChart3, label: 'Trading Terminal', desc: 'Charts & order execution', colorClass: 'bg-blue-50 dark:bg-[#1a2236] border-blue-200 dark:border-blue-900 text-blue-600 dark:text-blue-400 icon-bg-blue' },
                            { to: '/portfolio', icon: Briefcase, label: 'Portfolio', desc: 'Holdings & P&L tracking', colorClass: 'bg-green-50 dark:bg-[#0f2818] border-green-200 dark:border-green-900 text-green-600 dark:text-green-400 icon-bg-green' },
                            { to: '/algo', icon: Zap, label: 'Algo Strategies', desc: 'Automated trading bots', colorClass: 'bg-purple-50 dark:bg-[#1a1232] border-purple-200 dark:border-purple-900 text-purple-600 dark:text-purple-400 icon-bg-purple' },
                            { to: '/zeroloss', icon: ShieldCheck, label: 'ZeroLoss Strategy', desc: 'Confidence-gated trades', colorClass: 'bg-amber-50 dark:bg-[#1f140d] border-amber-200 dark:border-amber-900 text-amber-600 dark:text-amber-400 icon-bg-amber' },
                        ].map(({ to, icon: Icon, label, desc, colorClass }) => (
                            <Link key={to} to={to} aria-label={label} className={cn(
                                'flex items-center justify-between p-3.5 rounded-lg border transition-all duration-150 group',
                                'hover:shadow-sm',
                                colorClass.includes('blue') ? 'bg-blue-50 dark:bg-[#1a2236] border-blue-200 dark:border-blue-900 hover:border-blue-300 dark:hover:border-blue-800' :
                                colorClass.includes('green') ? 'bg-green-50 dark:bg-[#0f2818] border-green-200 dark:border-green-900 hover:border-green-300 dark:hover:border-green-800' :
                                colorClass.includes('purple') ? 'bg-purple-50 dark:bg-[#1a1232] border-purple-200 dark:border-purple-900 hover:border-purple-300 dark:hover:border-purple-800' :
                                'bg-amber-50 dark:bg-[#1f140d] border-amber-200 dark:border-amber-900 hover:border-amber-300 dark:hover:border-amber-800'
                            )}>
                                <div className="flex items-center gap-3">
                                    <div className={cn(
                                        'w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0',
                                        colorClass.includes('blue') ? 'bg-blue-500/15' :
                                        colorClass.includes('green') ? 'bg-green-500/15' :
                                        colorClass.includes('purple') ? 'bg-purple-500/15' :
                                        'bg-amber-500/15'
                                    )}>
                                        <Icon className={cn(
                                            'w-4 h-4',
                                            colorClass.includes('blue') ? 'text-blue-600 dark:text-blue-400' :
                                            colorClass.includes('green') ? 'text-green-600 dark:text-green-400' :
                                            colorClass.includes('purple') ? 'text-purple-600 dark:text-purple-400' :
                                            'text-amber-600 dark:text-amber-400'
                                        )} />
                                    </div>
                                    <div>
                                        <span className={cn(
                                            'text-sm font-semibold block',
                                            colorClass.includes('blue') ? 'text-blue-600 dark:text-blue-400' :
                                            colorClass.includes('green') ? 'text-green-600 dark:text-green-400' :
                                            colorClass.includes('purple') ? 'text-purple-600 dark:text-purple-400' :
                                            'text-amber-600 dark:text-amber-400'
                                        )}>{label}</span>
                                        <span className="text-[11px] text-gray-600 dark:text-gray-400">{desc}</span>
                                    </div>
                                </div>
                                <ArrowRight className={cn(
                                    'w-4 h-4 group-hover:translate-x-0.5 transition-transform',
                                    colorClass.includes('blue') ? 'text-blue-600 dark:text-blue-400' :
                                    colorClass.includes('green') ? 'text-green-600 dark:text-green-400' :
                                    colorClass.includes('purple') ? 'text-purple-600 dark:text-purple-400' :
                                    'text-amber-600 dark:text-amber-400'
                                )} />
                            </Link>
                        ))}
                    </div>
                </div>
            </div>

            {/* ── Row: Holdings Preview + Recent Orders ────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Holdings */}
                <div className="rounded-xl border border-edge/5 bg-surface-900/60 p-5">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="section-title text-sm text-heading">Holdings</h2>
                        <Link to="/portfolio" className="text-xs text-primary-600 hover:text-primary-500 transition-colors font-medium">View All →</Link>
                    </div>
                    {liveHoldings.length > 0 ? (
                        <div className="space-y-0.5">
                            {liveHoldings.slice(0, 5).map((h, i) => (
                                <div key={i} className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-surface-800/40 transition-colors">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-lg bg-primary-500/10 flex items-center justify-center text-[11px] font-semibold text-primary-600 flex-shrink-0">
                                            {(h.symbol?.replace('.NS', '') || '??').slice(0, 2)}
                                        </div>
                                        <div>
                                            <div className="text-sm font-semibold text-heading">{h.symbol?.replace('.NS', '')}</div>
                                            <div className="text-[11px] text-gray-600 font-price tabular-nums">{h.quantity} × {formatCurrency(h.avg_price)}</div>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-sm font-price font-semibold text-heading tabular-nums">{formatCurrency(h.current_value)}</div>
                                        <div className={cn('text-[11px] font-price tabular-nums', pnlColorClass(h.pnl))}>
                                            {(h.pnl ?? 0) >= 0 ? '+' : ''}{formatCurrency(h.pnl)} ({formatPercent(h.pnl_percent)})
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-center py-10">
                            <IndianRupee className="w-10 h-10 mx-auto mb-2 text-gray-600 opacity-30" />
                            <p className="text-sm font-medium text-gray-500">No holdings yet</p>
                            <Link to="/terminal" className="inline-flex items-center gap-1.5 mt-2 text-xs text-primary-600 hover:text-primary-500 font-medium transition-colors">
                                Start trading <ArrowRight className="w-3 h-3" />
                            </Link>
                        </div>
                    )}
                </div>

                {/* Recent Orders */}
                <div className="rounded-xl border border-edge/5 bg-surface-900/60 p-5">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="section-title text-sm text-heading">Recent Orders</h2>
                        <Link to="/terminal" className="text-xs text-primary-600 hover:text-primary-500 transition-colors font-medium">View All →</Link>
                    </div>
                    {recentOrders.length > 0 ? (
                        <div className="space-y-0.5">
                            {recentOrders.map((o, i) => (
                                <div key={i} className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-surface-800/40 transition-colors">
                                    <div className="flex items-center gap-3">
                                        <span className={cn(
                                            'text-[11px] font-semibold px-2 py-0.5 rounded-md',
                                            o.side === 'BUY' ? 'bg-profit/10 text-profit' : 'bg-loss/10 text-loss'
                                        )}>
                                            {o.side}
                                        </span>
                                        <div>
                                            <div className="text-sm font-semibold text-heading">{o.symbol?.replace('.NS', '')}</div>
                                            <div className="text-[11px] text-gray-600 font-price tabular-nums">{o.quantity} qty</div>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-sm font-price font-semibold text-heading tabular-nums">{formatCurrency(o.filled_price ?? o.price)}</div>
                                        <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-semibold',
                                            o.status === 'FILLED' ? 'text-profit bg-profit/10' :
                                                o.status === 'REJECTED' || o.status === 'CANCELLED' ? 'text-loss bg-loss/10' :
                                                    'text-[#0EA5E9] bg-[#0EA5E9]/10'
                                        )}>{o.status}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-center py-10">
                            <BarChart3 className="w-10 h-10 mx-auto mb-2 text-gray-600 opacity-30" />
                            <p className="text-sm font-medium text-gray-500">No orders yet</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
