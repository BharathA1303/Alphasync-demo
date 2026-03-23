import { memo, useState, useRef, useEffect } from 'react';
import { cn } from '../../utils/cn';
import { CHART_PERIODS } from '../../utils/constants';
import { formatPrice, formatPercent, pnlColorClass } from '../../utils/formatters';

const ALL_PERIODS = Object.entries(CHART_PERIODS);
const INTRADAY = ALL_PERIODS.filter(([, v]) => v.group === 'intraday');
const DAILY = ALL_PERIODS.filter(([, v]) => v.group === 'daily');
const EXTENDED = ALL_PERIODS.filter(([, v]) => v.group === 'extended');

function ChartHeader({
    symbol,
    quote,
    period,
    onPeriodChange,
    strategyDockOpen,
    onToggleStrategyDock,
    isWatchlisted = false,
    onToggleWatchlist,
    watchlistBusy = false,
    trendData,
    isMobile = false,
}) {
    const [open, setOpen] = useState(false);
    const dropRef = useRef(null);

    // Close on outside click
    useEffect(() => {
        if (!open) return;
        const handler = (e) => {
            if (dropRef.current && !dropRef.current.contains(e.target)) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    if (!symbol) return null;

    const currentLabel = CHART_PERIODS[period]?.label ?? period;

    return (
        <div className="flex items-center w-full h-11 px-4 border-b border-edge/5 bg-surface-900/30">

            {/* ── LEFT: Symbol + Price + Change ──────────────────── */}
            <div className="flex items-center gap-3 flex-shrink-0">
                <div className="flex flex-col leading-none">
                    <span className="text-sm font-semibold text-heading truncate max-w-[120px]">
                        {symbol.replace('.NS', '')}
                    </span>
                    <span className="text-[10px] text-gray-500 mt-0.5">NSE</span>
                </div>

                {quote?.price != null && (
                    <div className="flex items-center gap-2">
                        <span className="text-base font-semibold font-price text-heading tabular-nums">
                            {formatPrice(quote.price)}
                        </span>
                        {quote.change != null && !isMobile && (
                            <span className={cn(
                                'text-xs font-price font-medium whitespace-nowrap tabular-nums',
                                pnlColorClass(quote.change)
                            )}>
                                {quote.change >= 0 ? '+' : ''}
                                {formatPrice(quote.change)} ({formatPercent(quote.change_percent)})
                            </span>
                        )}
                    </div>
                )}
            </div>

            {/* Divider */}
            <div className="w-px h-5 bg-edge/10 mx-3 flex-shrink-0" />

            {/* ── CENTER: Timeframe dropdown + Strategy ───────────── */}
            <div className="flex items-center gap-2 flex-1 justify-center">
                {/* Timeframe dropdown */}
                <div className="relative" ref={dropRef}>
                    <button
                        onClick={() => setOpen((v) => !v)}
                        className={cn(
                            'h-7 px-2.5 rounded-md border text-xs font-semibold',
                            'inline-flex items-center gap-1.5 transition-colors duration-150',
                            open
                                ? 'bg-primary-600/20 border-primary-500/40 text-primary-600'
                                : 'bg-surface-800/80 border-edge/20 text-gray-600 hover:text-heading hover:border-edge/40'
                        )}
                    >
                        <span className="font-price tabular-nums">{currentLabel}</span>
                        <svg className={cn('w-3 h-3 transition-transform duration-150', open && 'rotate-180')} viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                        </svg>
                    </button>

                    {open && (
                        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 z-50 min-w-[160px] rounded-lg border border-edge/10 bg-surface-900/95 backdrop-blur-xl shadow-xl shadow-black/40 py-1.5">
                            <p className="px-3 pt-1 pb-1 text-[9px] font-semibold text-gray-500 uppercase tracking-wider">Intraday</p>
                            {INTRADAY.map(([key, { label }]) => (
                                <button
                                    key={key}
                                    onClick={() => { onPeriodChange?.(key); setOpen(false); }}
                                    className={cn(
                                        'w-full text-left px-3 py-1.5 text-xs font-medium transition-colors',
                                        'flex items-center justify-between',
                                        period === key
                                            ? 'bg-primary-600/15 text-primary-600'
                                            : 'text-gray-400 hover:text-heading hover:bg-edge/5'
                                    )}
                                >
                                    <span>{label}</span>
                                    {period === key && (
                                        <svg className="w-3 h-3 text-primary-600" viewBox="0 0 20 20" fill="currentColor">
                                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                        </svg>
                                    )}
                                </button>
                            ))}
                            <div className="h-px bg-edge/10 my-1.5 mx-2" />
                            <p className="px-3 pt-1 pb-1 text-[9px] font-semibold text-gray-500 uppercase tracking-wider">Daily+</p>
                            {DAILY.map(([key, { label }]) => (
                                <button
                                    key={key}
                                    onClick={() => { onPeriodChange?.(key); setOpen(false); }}
                                    className={cn(
                                        'w-full text-left px-3 py-1.5 text-xs font-medium transition-colors',
                                        'flex items-center justify-between',
                                        period === key
                                            ? 'bg-primary-600/15 text-primary-600'
                                            : 'text-gray-400 hover:text-heading hover:bg-edge/5'
                                    )}
                                >
                                    <span>{label}</span>
                                    {period === key && (
                                        <svg className="w-3 h-3 text-primary-600" viewBox="0 0 20 20" fill="currentColor">
                                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                        </svg>
                                    )}
                                </button>
                            ))}
                            <div className="h-px bg-edge/10 my-1.5 mx-2" />
                            <p className="px-3 pt-1 pb-1 text-[9px] font-semibold text-gray-500 uppercase tracking-wider">Extended</p>
                            {EXTENDED.map(([key, { label }]) => (
                                <button
                                    key={key}
                                    onClick={() => { onPeriodChange?.(key); setOpen(false); }}
                                    className={cn(
                                        'w-full text-left px-3 py-1.5 text-xs font-medium transition-colors',
                                        'flex items-center justify-between',
                                        period === key
                                            ? 'bg-primary-600/15 text-primary-600'
                                            : 'text-gray-400 hover:text-heading hover:bg-edge/5'
                                    )}
                                >
                                    <span>{label}</span>
                                    {period === key && (
                                        <svg className="w-3 h-3 text-primary-600" viewBox="0 0 20 20" fill="currentColor">
                                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                        </svg>
                                    )}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {!isMobile && (
                    <>
                        <button
                            onClick={onToggleWatchlist}
                            disabled={watchlistBusy}
                            className={cn(
                                'h-7 px-2 rounded-md border text-xs font-semibold',
                                'inline-flex items-center justify-center transition-colors duration-150 flex-shrink-0',
                                watchlistBusy && 'opacity-60 cursor-not-allowed',
                                isWatchlisted
                                    ? 'bg-primary-600/20 border-primary-500/40 text-primary-600'
                                    : 'bg-surface-800/80 border-edge/20 text-gray-400 hover:text-gray-700 hover:border-edge/40'
                            )}
                            title={isWatchlisted ? 'Remove from watchlist' : 'Add to watchlist'}
                            aria-label={isWatchlisted ? 'Remove from watchlist' : 'Add to watchlist'}
                        >
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill={isWatchlisted ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                                <path d="m12 2 3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14 2 9.27l6.91-1.01L12 2z" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </button>

                        <button
                            onClick={onToggleStrategyDock}
                            className={cn(
                                'h-7 px-2.5 rounded-md border text-xs font-semibold',
                                'inline-flex items-center justify-center gap-1.5',
                                'transition-colors duration-150 flex-shrink-0',
                                strategyDockOpen
                                    ? 'bg-primary-600/20 border-primary-500/40 text-primary-600'
                                    : 'bg-surface-800/80 border-edge/20 text-gray-400 hover:text-gray-700 hover:border-edge/40'
                            )}
                            title="Toggle Strategy Dock"
                        >
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M12 20V10M18 20V4M6 20v-4" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            <span className="hidden md:inline">Strategies</span>
                        </button>

                    </>
                )}
            </div>

        </div>
    );
}

export default memo(ChartHeader);
