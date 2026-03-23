/**
 * ZebuLiveChart — TradingView Lightweight Charts candlestick chart.
 *
 * Uses lightweight-charts v4 for professional charting.
 * All OHLCV data comes from Zebu REST API (/TPSeries, /EODChartData).
 * Live candle updates come from Zebu WebSocket ticks via the market store.
 *
 * Features:
 *  - Candlestick + volume chart via TradingView lightweight-charts
 *  - Real-time current candle updates from live tick data
 *  - Indicator overlays (EMA, SMA, BB, VWAP, SuperTrend, Ichimoku)
 *  - Toolbar with timeframe, indicators, drawing tools
 *  - Responsive resize via ResizeObserver
 *  - Fullscreen toggle
 *  - ZEBU LIVE badge
 */

import { useEffect, useRef, useState, useCallback, memo } from 'react';
import { createChart, CrosshairMode } from 'lightweight-charts';
import { TrendingUp, TrendingDown, MinusCircle } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { useMarketStore } from '../../store/useMarketStore';
import { cn } from '../../utils/cn';
import Skeleton from '../ui/Skeleton';
import {
    sma, ema, wma, dema, tema, hma,
    bollingerBands, vwap, supertrend, ichimoku, psar,
    keltnerChannels, donchianChannels, envelope, pivotPoints,
    rsi, macd, atr, adx, cci, stochastic,
    obv, mfi, williamsR, roc, aroon, cmf, stddev,
} from '../../strategy/indicators';

// ── Constants ─────────────────────────────────────────────────────────────────

const TREND_STYLE = {
    BULLISH: { cls: 'signal-pill signal-pill-bullish', icon: '▲', label: 'BULLISH' },
    BEARISH: { cls: 'signal-pill signal-pill-bearish', icon: '▼', label: 'BEARISH' },
    NEUTRAL: { cls: 'signal-pill signal-pill-neutral', icon: '—', label: 'NEUTRAL' },
};

const UP_COLOR = '#26A69A';
const DOWN_COLOR = '#EF5350';

const INDICATOR_DEFS = {
    // ── Moving Averages ──
    ema9:   { label: 'EMA 9',          group: 'Moving Averages', color: '#38BDF8', width: 1 },
    ema20:  { label: 'EMA 20',         group: 'Moving Averages', color: '#0EA5E9', width: 1.5 },
    ema50:  { label: 'EMA 50',         group: 'Moving Averages', color: '#8B5CF6', width: 1.5 },
    ema100: { label: 'EMA 100',        group: 'Moving Averages', color: '#D946EF', width: 1.5 },
    ema200: { label: 'EMA 200',        group: 'Moving Averages', color: '#EC4899', width: 2 },
    sma10:  { label: 'SMA 10',         group: 'Moving Averages', color: '#67E8F9', width: 1 },
    sma20:  { label: 'SMA 20',         group: 'Moving Averages', color: '#06B6D4', width: 1.5 },
    sma50:  { label: 'SMA 50',         group: 'Moving Averages', color: '#14B8A6', width: 1.5 },
    sma100: { label: 'SMA 100',        group: 'Moving Averages', color: '#2DD4BF', width: 1.5 },
    sma200: { label: 'SMA 200',        group: 'Moving Averages', color: '#F472B6', width: 2 },
    wma20:  { label: 'WMA 20',         group: 'Moving Averages', color: '#FACC15', width: 1.5 },
    wma50:  { label: 'WMA 50',         group: 'Moving Averages', color: '#EAB308', width: 1.5 },
    hma20:  { label: 'HMA 20',         group: 'Moving Averages', color: '#22D3EE', width: 1.5 },
    hma50:  { label: 'HMA 50',         group: 'Moving Averages', color: '#818CF8', width: 1.5 },
    dema20: { label: 'DEMA 20',        group: 'Moving Averages', color: '#FB923C', width: 1.5 },
    tema20: { label: 'TEMA 20',        group: 'Moving Averages', color: '#F97316', width: 1.5 },
    vwap:   { label: 'VWAP',           group: 'Moving Averages', color: '#A855F7', width: 2 },

    // ── Bands & Channels ──
    bb:       { label: 'Bollinger Bands',   group: 'Bands & Channels', color: '#0EA5E9', width: 1 },
    keltner:  { label: 'Keltner Channel',   group: 'Bands & Channels', color: '#8B5CF6', width: 1 },
    donchian: { label: 'Donchian Channel',  group: 'Bands & Channels', color: '#10B981', width: 1 },
    envelope: { label: 'MA Envelope',       group: 'Bands & Channels', color: '#F59E0B', width: 1 },

    // ── Trend ──
    supertrend: { label: 'SuperTrend',     group: 'Trend',  color: '#10B981', width: 2 },
    ichimoku:   { label: 'Ichimoku Cloud', group: 'Trend',  color: '#F97316', width: 1 },
    psar:       { label: 'Parabolic SAR',  group: 'Trend',  color: '#FBBF24', width: 0 },
    pivots:     { label: 'Pivot Points',   group: 'Trend',  color: '#94A3B8', width: 1 },

    // ── Oscillators ──
    rsi14:   { label: 'RSI (14)',         group: 'Oscillators', color: '#FBBF24', width: 1.5 },
    macd:    { label: 'MACD',             group: 'Oscillators', color: '#34D399', width: 1.5 },
    stoch:   { label: 'Stochastic',       group: 'Oscillators', color: '#4ADE80', width: 1.5 },
    cci20:   { label: 'CCI (20)',         group: 'Oscillators', color: '#FB923C', width: 1.5 },
    willr:   { label: 'Williams %R',      group: 'Oscillators', color: '#C084FC', width: 1.5 },
    roc12:   { label: 'ROC (12)',         group: 'Oscillators', color: '#F472B6', width: 1.5 },
    aroon25: { label: 'Aroon (25)',       group: 'Oscillators', color: '#2DD4BF', width: 1.5 },

    // ── Volatility ──
    atr14:  { label: 'ATR (14)',    group: 'Volatility', color: '#F472B6', width: 1.5 },
    adx14:  { label: 'ADX (14)',    group: 'Volatility', color: '#A78BFA', width: 1.5 },
    stddev: { label: 'Std Dev (20)',group: 'Volatility', color: '#FB7185', width: 1.5 },

    // ── Volume ──
    obv:   { label: 'OBV',                group: 'Volume', color: '#22D3EE', width: 1.5 },
    mfi14: { label: 'MFI (14)',           group: 'Volume', color: '#34D399', width: 1.5 },
    cmf20: { label: 'Chaikin MF (20)',    group: 'Volume', color: '#FBBF24', width: 1.5 },
};

// Indicators that use a separate oscillator price scale (not overlaid on price)
const OSCILLATOR_IDS = new Set([
    'rsi14', 'macd', 'atr14', 'adx14', 'cci20', 'stoch',
    'willr', 'roc12', 'aroon25', 'obv', 'mfi14', 'cmf20', 'stddev',
]);

// ── Indicator computation ─────────────────────────────────────────────────────

function computeIndicatorData(id, candles) {
    const closes = candles.map(c => c.close);
    const toLineData = (vals, clr, w = 1.5, scaleId) => ({
        values: vals.map((v, i) => ({
            time: candles[i].time,
            value: isNaN(v) || !isFinite(v) ? undefined : v,
        })).filter(d => d.value !== undefined),
        color: clr,
        width: w,
        priceScaleId: scaleId,
    });
    const def = INDICATOR_DEFS[id] || {};
    const osc = 'oscillator';

    switch (id) {
        // ── Moving Averages (overlay on price) ──
        case 'ema9':   return [toLineData(ema(closes, 9),   def.color, def.width)];
        case 'ema20':  return [toLineData(ema(closes, 20),  def.color, def.width)];
        case 'ema50':  return [toLineData(ema(closes, 50),  def.color, def.width)];
        case 'ema100': return [toLineData(ema(closes, 100), def.color, def.width)];
        case 'ema200': return [toLineData(ema(closes, 200), def.color, def.width)];
        case 'sma10':  return [toLineData(sma(closes, 10),  def.color, def.width)];
        case 'sma20':  return [toLineData(sma(closes, 20),  def.color, def.width)];
        case 'sma50':  return [toLineData(sma(closes, 50),  def.color, def.width)];
        case 'sma100': return [toLineData(sma(closes, 100), def.color, def.width)];
        case 'sma200': return [toLineData(sma(closes, 200), def.color, def.width)];
        case 'wma20':  return [toLineData(wma(closes, 20),  def.color, def.width)];
        case 'wma50':  return [toLineData(wma(closes, 50),  def.color, def.width)];
        case 'hma20':  return [toLineData(hma(closes, 20),  def.color, def.width)];
        case 'hma50':  return [toLineData(hma(closes, 50),  def.color, def.width)];
        case 'dema20': return [toLineData(dema(closes, 20), def.color, def.width)];
        case 'tema20': return [toLineData(tema(closes, 20), def.color, def.width)];
        case 'vwap':   return [toLineData(vwap(candles),    def.color, def.width)];

        // ── Bands & Channels (overlay on price) ──
        case 'bb': {
            const { upper, middle, lower } = bollingerBands(closes, 20, 2);
            return [toLineData(upper, '#0369A1', 1), toLineData(middle, '#0EA5E9', 1), toLineData(lower, '#0369A1', 1)];
        }
        case 'keltner': {
            const { upper, middle, lower } = keltnerChannels(candles, 20, 1.5);
            return [toLineData(upper, '#7C3AED', 1), toLineData(middle, '#8B5CF6', 1), toLineData(lower, '#7C3AED', 1)];
        }
        case 'donchian': {
            const { upper, middle, lower } = donchianChannels(candles, 20);
            return [toLineData(upper, '#059669', 1), toLineData(middle, '#10B981', 1), toLineData(lower, '#059669', 1)];
        }
        case 'envelope': {
            const { upper, middle, lower } = envelope(closes, 20, 2.5);
            return [toLineData(upper, '#D97706', 1), toLineData(middle, '#F59E0B', 1), toLineData(lower, '#D97706', 1)];
        }

        // ── Trend (overlay on price) ──
        case 'supertrend': {
            const { supertrend: st, direction: dir } = supertrend(candles, 10, 3);
            return [
                toLineData(st.map((v, i) => dir[i] === 1 ? v : NaN), '#10B981', 2),
                toLineData(st.map((v, i) => dir[i] !== 1 ? v : NaN), '#EF4444', 2),
            ];
        }
        case 'ichimoku': {
            const { tenkan, kijun, senkouA, senkouB } = ichimoku(candles, 9, 26, 52);
            return [toLineData(tenkan, '#2DD4BF', 1), toLineData(kijun, '#F87171', 1), toLineData(senkouA, '#A3E635', 1), toLineData(senkouB, '#FB923C', 1)];
        }
        case 'psar': {
            const { sar, direction } = psar(candles, 0.02, 0.2);
            return [
                toLineData(sar.map((v, i) => direction[i] === 1 ? v : NaN), '#10B981', 1),
                toLineData(sar.map((v, i) => direction[i] !== 1 ? v : NaN), '#EF4444', 1),
            ];
        }
        case 'pivots': {
            const { pp, r1, r2, s1, s2 } = pivotPoints(candles);
            return [
                toLineData(pp, '#94A3B8', 1), toLineData(r1, '#F87171', 1), toLineData(r2, '#EF4444', 1),
                toLineData(s1, '#34D399', 1), toLineData(s2, '#10B981', 1),
            ];
        }

        // ── Oscillators (separate pane) ──
        case 'rsi14':
            return [toLineData(rsi(closes, 14), def.color, 1.5, osc)];
        case 'macd': {
            const { macd: ml, signal: sl } = macd(closes, 12, 26, 9);
            return [toLineData(ml, '#34D399', 1.5, osc), toLineData(sl, '#F87171', 1, osc)];
        }
        case 'stoch': {
            const { k, d } = stochastic(candles, 14, 3, 3);
            return [toLineData(k, '#4ADE80', 1.5, osc), toLineData(d, '#FB923C', 1, osc)];
        }
        case 'cci20':
            return [toLineData(cci(candles, 20), def.color, 1.5, osc)];
        case 'willr':
            return [toLineData(williamsR(candles, 14), def.color, 1.5, osc)];
        case 'roc12':
            return [toLineData(roc(closes, 12), def.color, 1.5, osc)];
        case 'aroon25': {
            const { up, down } = aroon(candles, 25);
            return [toLineData(up, '#2DD4BF', 1.5, osc), toLineData(down, '#F87171', 1, osc)];
        }

        // ── Volatility (separate pane) ──
        case 'atr14':
            return [toLineData(atr(candles, 14), def.color, 1.5, osc)];
        case 'adx14': {
            const { adx: adxVals, plusDI, minusDI } = adx(candles, 14);
            return [toLineData(adxVals, '#A78BFA', 2, osc), toLineData(plusDI, '#34D399', 1, osc), toLineData(minusDI, '#F87171', 1, osc)];
        }
        case 'stddev':
            return [toLineData(stddev(closes, 20), def.color, 1.5, osc)];

        // ── Volume (separate pane) ──
        case 'obv':
            return [toLineData(obv(candles), def.color, 1.5, osc)];
        case 'mfi14':
            return [toLineData(mfi(candles, 14), def.color, 1.5, osc)];
        case 'cmf20':
            return [toLineData(cmf(candles, 20), def.color, 1.5, osc)];

        default: return [];
    }
}

// ── Toolbar sub-components ────────────────────────────────────────────────────

function IndicatorMenu({ active, onToggle, menuRef }) {
    const [search, setSearch] = useState('');
    const GROUP_ORDER = ['Moving Averages', 'Bands & Channels', 'Trend', 'Oscillators', 'Volatility', 'Volume'];
    const groups = {};
    Object.entries(INDICATOR_DEFS).forEach(([id, def]) => {
        if (search && !def.label.toLowerCase().includes(search.toLowerCase())) return;
        (groups[def.group] = groups[def.group] || []).push({ id, ...def });
    });
    const sortedGroups = GROUP_ORDER.filter(g => groups[g]).map(g => [g, groups[g]]);
    return (
        <div ref={menuRef} className="absolute top-full left-0 mt-1 w-64 bg-surface-800 border border-edge/10 rounded-xl shadow-panel z-50 animate-slide-in overflow-hidden"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}>
            <div className="px-3 py-2 border-b border-edge/5">
                <div className="text-[11px] text-gray-500 font-semibold uppercase tracking-wider mb-1.5">Indicators</div>
                <input
                    type="text" placeholder="Search indicators..." value={search} onChange={e => setSearch(e.target.value)}
                    className="w-full bg-surface-700/60 border border-edge/10 rounded-md px-2 py-1 text-xs text-heading placeholder-gray-600 focus:outline-none focus:border-primary-500/30"
                    autoFocus
                />
            </div>
            <div className="max-h-80 overflow-y-auto py-1">
                {sortedGroups.map(([group, items]) => (
                    <div key={group}>
                        <div className="px-3 pt-2.5 pb-1 text-[10px] text-gray-500 uppercase tracking-wider font-semibold flex items-center gap-2">
                            <span>{group}</span>
                            <span className="flex-1 h-px bg-edge/5" />
                            <span className="text-gray-600">{items.length}</span>
                        </div>
                        {items.map(ind => (
                            <button key={ind.id} onClick={() => onToggle(ind.id)}
                                className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-overlay/5 transition-colors text-left">
                                <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0 border"
                                    style={{ backgroundColor: active.has(ind.id) ? ind.color : 'transparent', borderColor: ind.color }} />
                                <span className={cn('text-xs', active.has(ind.id) ? 'text-heading font-medium' : 'text-gray-400')}>{ind.label}</span>
                                {active.has(ind.id) && <span className="ml-auto text-[10px] text-primary-500">✓</span>}
                            </button>
                        ))}
                    </div>
                ))}
                {sortedGroups.length === 0 && (
                    <div className="px-3 py-4 text-xs text-gray-600 text-center">No indicators match "{search}"</div>
                )}
            </div>
            {active.size > 0 && (
                <div className="px-3 py-1.5 border-t border-edge/5 flex items-center justify-between">
                    <span className="text-[11px] text-gray-500">{active.size} active</span>
                    <button onClick={() => active.forEach(id => onToggle(id))} className="text-[11px] text-red-400 hover:text-red-300 transition-colors">Clear all</button>
                </div>
            )}
        </div>
    );
}

function ToolsMenu({ activeTool, onSelect, onClose, menuRef }) {
    const toolGroups = [
        {
            label: 'Cursor',
            items: [
                { id: 'crosshair', label: 'Crosshair',     icon: '＋' },
            ],
        },
        {
            label: 'Lines',
            items: [
                { id: 'hline',     label: 'Horizontal Line',    icon: '─' },
                { id: 'hline_sup', label: 'Support Line',       icon: '─', color: '#10B981' },
                { id: 'hline_res', label: 'Resistance Line',    icon: '─', color: '#EF4444' },
            ],
        },
        {
            label: 'Levels',
            items: [
                { id: 'hline_target', label: 'Target Price',    icon: '◎', color: '#0EA5E9' },
                { id: 'hline_sl',     label: 'Stop Loss',       icon: '⊘', color: '#EF4444' },
                { id: 'hline_entry',  label: 'Entry Price',     icon: '▸', color: '#FBBF24' },
            ],
        },
    ];
    return (
        <div ref={menuRef} className="absolute top-full left-0 mt-1 w-52 bg-surface-800 border border-edge/10 rounded-xl shadow-panel z-50 animate-slide-in overflow-hidden">
            <div className="px-3 py-2 border-b border-edge/5 text-[11px] text-gray-500 font-semibold uppercase tracking-wider">Drawing Tools</div>
            <div className="py-1">
                {toolGroups.map(group => (
                    <div key={group.label}>
                        <div className="px-3 pt-2 pb-1 text-[10px] text-gray-600 uppercase tracking-wider font-medium">{group.label}</div>
                        {group.items.map(t => (
                            <button key={t.id} onClick={() => { onSelect(activeTool === t.id ? null : t.id); onClose(); }}
                                className={cn('w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-overlay/5 transition-colors text-left', activeTool === t.id && 'bg-primary-500/10')}>
                                <span className="w-5 text-center text-sm flex-shrink-0" style={{ color: t.color || '#9CA3AF' }}>{t.icon}</span>
                                <span className={cn('text-xs', activeTool === t.id ? 'text-primary-600 font-medium' : 'text-gray-400')}>{t.label}</span>
                            </button>
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
}

function ActivePills({ active, onRemove }) {
    if (active.size === 0) return null;
    return (
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
            {[...active].map(id => {
                const def = INDICATOR_DEFS[id];
                if (!def) return null;
                return (
                    <span key={id} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border whitespace-nowrap"
                        style={{ borderColor: def.color + '40', color: def.color, backgroundColor: def.color + '10' }}>
                        {def.label}
                        <button onClick={() => onRemove(id)} className="hover:opacity-60 leading-none">×</button>
                    </span>
                );
            })}
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── ZebuLiveChart React component ─────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

const ZebuLiveChart = memo(function ZebuLiveChart({
    candles = [],
    isLoading = false,
    trendData = null,
    period = '1D',
    onPeriodChange,
    symbol = '',
    zeroLossTrend = null,
}) {
    const { theme } = useTheme();
    const chartContainerRef = useRef(null);
    const chartWrapperRef = useRef(null);
    const chartRef = useRef(null);
    const candleSeriesRef = useRef(null);
    const volumeSeriesRef = useRef(null);
    const indicatorSeriesRef = useRef([]);
    const livePriceLineRef = useRef(null);
    const hLinePricesRef = useRef([]);
    const candlesRef = useRef([]);
    const activeToolRef = useRef(null);

    const liveQuote = useMarketStore((s) => s.symbols[symbol] ?? null);
    const wsStatus = useMarketStore((s) => s.wsStatus);
    const lastQuoteAt = useMarketStore((s) => s.lastQuoteAt);

    const [activeIndicators, setActiveIndicators] = useState(new Set());
    const [showIndicatorMenu, setShowIndicatorMenu] = useState(false);
    const [showToolsMenu, setShowToolsMenu] = useState(false);
    const [activeTool, setActiveTool] = useState(null);
    const [hLines, setHLines] = useState([]);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [statusTick, setStatusTick] = useState(Date.now());

    const menuRef = useRef(null);
    const indicatorMenuRef = useRef(null);
    const toolsMenuRef = useRef(null);

    // Keep activeToolRef in sync for chart click handler
    useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);

    // Tick used to re-evaluate freshness-based connectivity label.
    useEffect(() => {
        const id = setInterval(() => setStatusTick(Date.now()), 15_000);
        return () => clearInterval(id);
    }, []);

    // ── Close menus on outside click ──────────────────────────────
    useEffect(() => {
        if (!showIndicatorMenu && !showToolsMenu) return;
        const handler = (e) => {
            if (indicatorMenuRef.current && !indicatorMenuRef.current.contains(e.target)) setShowIndicatorMenu(false);
            if (toolsMenuRef.current && !toolsMenuRef.current.contains(e.target)) setShowToolsMenu(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [showIndicatorMenu, showToolsMenu]);

    // ── Indicator toggle ──────────────────────────────────────────
    const toggleIndicator = useCallback((id) => {
        setActiveIndicators(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    }, []);

    // ── Chart creation & cleanup ──────────────────────────────────
    useEffect(() => {
        if (!chartContainerRef.current) return;

        const isDark = theme === 'dark';
        const chart = createChart(chartContainerRef.current, {
            autoSize: true,
            layout: {
                background: { color: 'transparent' },
                textColor: isDark ? '#9ca3af' : '#6b7280',
                fontFamily: 'Inter, system-ui, sans-serif',
                fontSize: 11,
            },
            grid: {
                vertLines: { color: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.06)' },
                horzLines: { color: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.06)' },
            },
            crosshair: {
                mode: CrosshairMode.Normal,
                vertLine: { color: 'rgba(99,102,241,0.4)', width: 1, style: 3, labelBackgroundColor: 'rgba(99,102,241,0.85)', labelVisible: false },
                horzLine: { color: 'rgba(99,102,241,0.4)', width: 1, style: 3, labelBackgroundColor: 'rgba(99,102,241,0.85)' },
            },
            rightPriceScale: {
                borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)',
                scaleMargins: { top: 0.08, bottom: 0.22 },
            },
            timeScale: {
                borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)',
                timeVisible: true,
                secondsVisible: false,
                rightOffset: 5,
                barSpacing: 8,
                minBarSpacing: 2,
            },
            handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
            handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
        });

        const candleSeries = chart.addCandlestickSeries({
            upColor: UP_COLOR,
            downColor: DOWN_COLOR,
            borderUpColor: UP_COLOR,
            borderDownColor: DOWN_COLOR,
            wickUpColor: UP_COLOR,
            wickDownColor: DOWN_COLOR,
        });

        const volumeSeries = chart.addHistogramSeries({
            priceFormat: { type: 'volume' },
            priceScaleId: 'volume',
        });
        chart.priceScale('volume').applyOptions({
            scaleMargins: { top: 0.82, bottom: 0 },
        });

        chartRef.current = chart;
        candleSeriesRef.current = candleSeries;
        volumeSeriesRef.current = volumeSeries;

        // Click handler for horizontal line tools
        chart.subscribeClick((param) => {
            const tool = activeToolRef.current;
            if (!tool || tool === 'crosshair' || !param.point) return;
            const price = candleSeries.coordinateToPrice(param.point.y);
            if (price != null && isFinite(price)) {
                const colorMap = {
                    hline:        '#0EA5E9',
                    hline_sup:    '#10B981',
                    hline_res:    '#EF4444',
                    hline_target: '#0EA5E9',
                    hline_sl:     '#EF4444',
                    hline_entry:  '#FBBF24',
                };
                const labelMap = {
                    hline_sup:    'Support',
                    hline_res:    'Resistance',
                    hline_target: 'Target',
                    hline_sl:     'Stop Loss',
                    hline_entry:  'Entry',
                };
                const color = colorMap[tool] || '#0EA5E9';
                const title = labelMap[tool] || '';
                setHLines(prev => [...prev, { price, color, title }]);
            }
        });

        return () => {
            chart.remove();
            chartRef.current = null;
            candleSeriesRef.current = null;
            volumeSeriesRef.current = null;
            indicatorSeriesRef.current = [];
        };
    }, [theme]); // Recreate chart when theme changes

    // ── Set candle data ───────────────────────────────────────────
    useEffect(() => {
        const cs = candleSeriesRef.current;
        const vs = volumeSeriesRef.current;
        if (!cs || !vs) return;

        if (!candles || candles.length === 0) {
            candlesRef.current = [];
            cs.setData([]);
            vs.setData([]);
            return;
        }

        // Deduplicate by time (keep last occurrence)
        const seen = new Map();
        for (const c of candles) {
            seen.set(c.time, c);
        }
        const deduped = [...seen.values()].sort((a, b) => a.time - b.time);

        candlesRef.current = deduped.map(c => ({ ...c }));

        cs.setData(deduped.map(c => ({
            time: c.time,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
        })));

        vs.setData(deduped.map(c => ({
            time: c.time,
            value: c.volume || 0,
            color: c.close >= c.open ? 'rgba(38,166,154,0.35)' : 'rgba(239,83,80,0.35)',
        })));

        // Fit content
        chartRef.current?.timeScale().fitContent();
    }, [candles, theme]);

    // ── Live price updates ────────────────────────────────────────
    useEffect(() => {
        const cs = candleSeriesRef.current;
        const vs = volumeSeriesRef.current;
        if (!cs || !vs || !liveQuote?.price || candlesRef.current.length === 0) return;

        const ltp = liveQuote.price;
        const lastCandle = candlesRef.current[candlesRef.current.length - 1];
        if (!lastCandle) return;

        // Update the last candle with live price
        const updated = { ...lastCandle };
        updated.close = ltp;
        if (ltp > updated.high) updated.high = ltp;
        if (ltp < updated.low) updated.low = ltp;
        candlesRef.current[candlesRef.current.length - 1] = updated;

        cs.update({
            time: updated.time,
            open: updated.open,
            high: updated.high,
            low: updated.low,
            close: updated.close,
        });

        vs.update({
            time: updated.time,
            value: updated.volume || 0,
            color: updated.close >= updated.open ? 'rgba(38,166,154,0.35)' : 'rgba(239,83,80,0.35)',
        });

        // Update live price line
        if (livePriceLineRef.current) {
            try { cs.removePriceLine(livePriceLineRef.current); } catch { /* ignore */ }
        }
        livePriceLineRef.current = cs.createPriceLine({
            price: ltp,
            color: '#0EA5E9',
            lineWidth: 1,
            lineStyle: 2, // Dashed
            axisLabelVisible: false,
            title: '',
        });
    }, [liveQuote]);

    // ── Indicator overlays ────────────────────────────────────────
    useEffect(() => {
        const chart = chartRef.current;
        if (!chart || candlesRef.current.length === 0) return;

        // Remove old indicator series
        for (const s of indicatorSeriesRef.current) {
            try { chart.removeSeries(s); } catch { /* ignore */ }
        }
        indicatorSeriesRef.current = [];

        const hasOscillator = [...activeIndicators].some(id => OSCILLATOR_IDS.has(id));

        // Adjust main candle scale to leave room for oscillator panel
        chart.priceScale('right').applyOptions({
            scaleMargins: hasOscillator ? { top: 0.08, bottom: 0.30 } : { top: 0.08, bottom: 0.22 },
        });
        if (hasOscillator) {
            chart.priceScale('oscillator').applyOptions({
                scaleMargins: { top: 0.76, bottom: 0.02 },
                borderVisible: true,
            });
        }

        // Add new ones
        for (const id of activeIndicators) {
            const lines = computeIndicatorData(id, candlesRef.current);
            for (const line of lines) {
                const series = chart.addLineSeries({
                    color: line.color,
                    lineWidth: line.width,
                    priceLineVisible: false,
                    lastValueVisible: false,
                    crosshairMarkerVisible: false,
                    ...(line.priceScaleId ? { priceScaleId: line.priceScaleId } : {}),
                });
                series.setData(line.values);
                indicatorSeriesRef.current.push(series);
            }
        }
    }, [activeIndicators, candles, theme]);

    // ── Horizontal user lines ─────────────────────────────────────
    useEffect(() => {
        const cs = candleSeriesRef.current;
        if (!cs) return;

        // Remove old hLines
        for (const pl of hLinePricesRef.current) {
            try { cs.removePriceLine(pl); } catch { /* ignore */ }
        }
        hLinePricesRef.current = [];

        // Add new
        for (const hl of hLines) {
            const pl = cs.createPriceLine({
                price: hl.price,
                color: hl.color || '#0EA5E9',
                lineWidth: 1,
                lineStyle: 2,
                axisLabelVisible: true,
                title: hl.title || '',
            });
            hLinePricesRef.current.push(pl);
        }
    }, [hLines, theme]);

    // ── Fullscreen ────────────────────────────────────────────────
    const toggleFullscreen = useCallback(() => {
        if (!chartWrapperRef.current) return;
        if (!document.fullscreenElement) {
            chartWrapperRef.current.requestFullscreen().catch(() => { });
        } else {
            document.exitFullscreen().catch(() => { });
        }
    }, []);

    useEffect(() => {
        const handler = () => {
            setIsFullscreen(document.fullscreenElement === chartWrapperRef.current);
            // autoSize handles resize automatically via its internal ResizeObserver.
        };

        document.addEventListener('fullscreenchange', handler);
        return () => {
            document.removeEventListener('fullscreenchange', handler);
        };
    }, []);

    const clearDrawings = useCallback(() => setHLines([]), []);

    const hasFreshQuotes = lastQuoteAt > 0 && (statusTick - lastQuoteAt) < 90_000;
    const effectiveWsStatus = wsStatus === 'connected'
        ? 'connected'
        : hasFreshQuotes
            ? 'connected'
            : wsStatus;

    const trend = trendData?.overall ? TREND_STYLE[trendData.overall] || TREND_STYLE.NEUTRAL : null;
    const confidence = trendData?.confidence ?? 0;

    function getZeroLossBadge(zl) {
        if (!zl) return null;
        const dir = zl.direction;
        let color, icon, label;
        if (dir === 'BULLISH') { color = 'bg-emerald-500/15 border-emerald-500/25 text-emerald-600'; icon = <TrendingUp className="w-3.5 h-3.5" />; label = 'BULLISH'; }
        else if (dir === 'BEARISH') { color = 'bg-red-500/15 border-red-500/25 text-red-500'; icon = <TrendingDown className="w-3.5 h-3.5" />; label = 'BEARISH'; }
        else { color = 'bg-[#0EA5E9]/10 border-[#0EA5E9]/20 text-[#0EA5E9]'; icon = <MinusCircle className="w-3.5 h-3.5" />; label = 'NEUTRAL'; }
        return (
            <div className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-bold', color, 'backdrop-blur-md shadow-lg')} style={{ marginTop: 4 }}>
                {icon}<span>ZeroLoss</span><span>{label}</span>
                {typeof zl.score === 'number' && zl.score > 0 && <span className="opacity-60 font-medium ml-0.5">{Math.round(zl.score)}%</span>}
            </div>
        );
    }

    return (
        <div ref={chartWrapperRef} className={cn('flex flex-col h-full relative overflow-hidden', isFullscreen && 'bg-surface-900 z-50')}>
            {/* ── Toolbar ──────────────────────────────────────────── */}
            <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-edge/5 bg-surface-900/30 flex-shrink-0" ref={menuRef}>
                <div className={cn(
                    'flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-semibold flex-shrink-0 border',
                    effectiveWsStatus === 'connected'
                        ? 'text-emerald-600 bg-emerald-500/10 border-emerald-500/20'
                        : effectiveWsStatus === 'connecting'
                            ? 'text-[#0EA5E9] bg-[#0EA5E9]/10 border-[#0EA5E9]/20'
                            : 'text-gray-500 bg-surface-800/60 border-edge/10'
                )}>
                    <span className={cn(
                        'w-1.5 h-1.5 rounded-full',
                        effectiveWsStatus === 'connected' ? 'bg-emerald-400 animate-pulse'
                            : effectiveWsStatus === 'connecting' ? 'bg-[#0EA5E9] animate-pulse'
                                : 'bg-gray-500'
                    )} />
                    {effectiveWsStatus === 'connected'
                        ? 'LIVE'
                        : effectiveWsStatus === 'connecting'
                            ? 'CONNECTING'
                            : 'OFFLINE'}
                </div>

                <div className="relative flex-shrink-0">
                    <button onClick={() => { setShowIndicatorMenu(v => !v); setShowToolsMenu(false); }}
                        className={cn('flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-semibold transition-colors',
                            activeIndicators.size > 0 ? 'bg-primary-500/15 text-primary-600 border border-primary-500/20' : 'text-gray-500 hover:text-gray-700 hover:bg-surface-800/60')}>
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M3 3v18h18" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="M7 16l4-8 4 5 5-9" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        Indicators
                        {activeIndicators.size > 0 && <span className="ml-0.5 w-4 h-4 rounded-full bg-primary-500/30 text-[10px] flex items-center justify-center">{activeIndicators.size}</span>}
                    </button>
                    {showIndicatorMenu && <IndicatorMenu active={activeIndicators} onToggle={toggleIndicator} menuRef={indicatorMenuRef} />}
                </div>

                <div className="relative flex-shrink-0">
                    <button onClick={() => { setShowToolsMenu(v => !v); setShowIndicatorMenu(false); }}
                        className={cn('flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-semibold transition-colors',
                            activeTool ? 'bg-primary-500/15 text-primary-600 border border-primary-500/20' : 'text-gray-500 hover:text-gray-700 hover:bg-surface-800/60')}>
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M2 17l10-10M11.7 7.3l4-4a1.4 1.4 0 0 1 2 2l-4 4M15.7 11.3l4 4a1.4 1.4 0 0 1-2 2l-4-4" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="M18 22H4a2 2 0 0 1-2-2V4" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        Tools
                    </button>
                    {showToolsMenu && <ToolsMenu activeTool={activeTool} onSelect={setActiveTool} onClose={() => setShowToolsMenu(false)} menuRef={toolsMenuRef} />}
                </div>

                {hLines.length > 0 && (
                    <button onClick={clearDrawings} className="px-2 py-1 rounded text-[11px] font-semibold text-gray-600 hover:text-red-500 hover:bg-red-500/10 transition-colors flex-shrink-0">
                        Clear drawings
                    </button>
                )}

                <div className="flex-1 min-w-0 flex justify-end items-center gap-1">
                    <ActivePills active={activeIndicators} onRemove={toggleIndicator} />
                    <button onClick={toggleFullscreen} className="p-1 rounded text-gray-500 hover:text-gray-700 hover:bg-surface-800/60 transition-colors flex-shrink-0" title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
                        {isFullscreen ? (
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
                            </svg>
                        ) : (
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                            </svg>
                        )}
                    </button>
                </div>
            </div>

            {/* ── Chart area ───────────────────────────────────────── */}
            <div className="flex-1 relative min-h-0">
                {isLoading || candles.length === 0 ? (
                    <div className="absolute inset-0 flex items-center justify-center z-20">
                        <Skeleton variant="chart" className="absolute inset-0 rounded-none" />
                        {!isLoading && candles.length === 0 && (
                            <div className="relative z-10 text-gray-600 text-sm">No chart data — symbol may not be supported</div>
                        )}
                    </div>
                ) : null}

                {candles.length > 0 && !isLoading && (
                    <div className="absolute top-3 right-20 z-10 pointer-events-none select-none flex flex-col items-end gap-1.5">
                        {trend && (
                            <div className={cn(trend.cls, 'text-xs font-bold backdrop-blur-md shadow-lg')}>
                                <span className="text-sm leading-none">{trend.icon}</span>
                                <span>Multi-Strategy</span>
                                <span>{trend.label}</span>
                                {confidence > 0 && <span className="opacity-60 font-price font-medium ml-0.5">{Math.round(confidence)}%</span>}
                            </div>
                        )}
                        {getZeroLossBadge(zeroLossTrend)}
                    </div>
                )}

                {activeTool && (
                    <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-10 pointer-events-none select-none">
                        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-800/90 border border-edge/10 text-xs text-gray-400 backdrop-blur-sm shadow-lg">
                            {activeTool === 'hline' && 'Click to place horizontal line'}
                            {activeTool === 'hline_sup' && 'Click to place support line (green)'}
                            {activeTool === 'hline_res' && 'Click to place resistance line (red)'}
                            {activeTool === 'crosshair' && 'Crosshair mode active'}
                            <button onClick={() => setActiveTool(null)} className="ml-2 text-gray-600 hover:text-gray-700 pointer-events-auto">ESC</button>
                        </div>
                    </div>
                )}

                <div ref={chartContainerRef} className="absolute inset-0"
                    style={{ visibility: candles.length > 0 && !isLoading ? 'visible' : 'hidden' }} />
            </div>
        </div>
    );
}, (prev, next) =>
    prev.candles === next.candles &&
    prev.isLoading === next.isLoading &&
    prev.period === next.period &&
    prev.symbol === next.symbol &&
    prev.trendData?.overall === next.trendData?.overall &&
    prev.trendData?.confidence === next.trendData?.confidence &&
    prev.zeroLossTrend === next.zeroLossTrend
);

export default ZebuLiveChart;
