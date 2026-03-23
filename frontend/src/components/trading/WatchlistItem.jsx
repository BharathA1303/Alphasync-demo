import { memo, useRef, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '../../utils/cn';
import { formatPrice, formatPercent } from '../../utils/formatters';

/**
 * Single watchlist row.
 * — Default state : symbol name (left) + price & change% (right)
 * — Hover state   : prices stay visible, action buttons appear as overlay
 * Price-flash animation on LTP change is preserved.
 */
const WatchlistItem = memo(function WatchlistItem({
    item,
    price = {},
    isSelected,
    onSelect,
    onRemove,
    onBuy,
    onSell,
}) {
    const navigate = useNavigate();
    const [flashClass, setFlashClass] = useState('');
    const [hovered, setHovered] = useState(false);
    const prevPriceRef = useRef(price?.price);

    // ── Price flash animation ─────────────────────────────────────────────────
    useEffect(() => {
        const prev = prevPriceRef.current;
        const curr = price?.price;
        if (prev !== undefined && curr !== undefined && prev !== curr) {
            const cls = curr > prev ? 'animate-price-up' : 'animate-price-down';
            setFlashClass(cls);
            const t = setTimeout(() => setFlashClass(''), 450);
            prevPriceRef.current = curr;
            return () => clearTimeout(t);
        }
        prevPriceRef.current = curr;
    }, [price?.price]);

    const changePositive = (price?.change ?? 0) >= 0;
    const symbol = item.symbol?.replace('.NS', '');
    const exchange = item.exchange || 'NSE';

    return (
        <div
            onClick={onSelect}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            className={cn(
                'relative flex items-center justify-between px-3 py-2 cursor-pointer',
                'border-b border-edge/[0.03]',
                'transition-colors duration-150',
                isSelected
                    ? 'bg-primary-500/10 border-l-[3px] border-l-primary-500 hover:bg-primary-500/15 dark:bg-slate-700/60 dark:hover:bg-slate-700/80'
                    : 'border-l-[3px] border-l-transparent hover:bg-slate-100 dark:hover:bg-slate-800/50',
                flashClass
            )}
        >
            {/* ── Left: symbol + exchange badge ───────────────────────────── */}
            <div className="flex-1 min-w-0">
                <div className="font-semibold text-[13px] text-heading truncate">{symbol}</div>
                <div className="flex items-center gap-1 mt-0.5">
                    <span className={cn(
                        'inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium leading-none tracking-wide',
                        'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
                        '',
                    )}>
                        {exchange}
                    </span>
                    {item.company_name && (
                        <span className="text-[10px] text-slate-500 dark:text-slate-500 truncate leading-tight max-w-[90px]">
                            {item.company_name}
                        </span>
                    )}
                </div>
            </div>

            {/* ── Right: action buttons (hover) + price always visible ── */}
            <div className="flex-shrink-0 ml-1 flex items-center gap-1.5">
                {/* Action buttons — appear on hover, placed left of prices */}
                {hovered && (
                    <div className="flex items-center gap-0.5 animate-fade-in">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                const sym = item.symbol?.endsWith('.NS') ? item.symbol : `${item.symbol}.NS`;
                                navigate(`/terminal?symbol=${encodeURIComponent(sym)}`);
                            }}
                            className="p-1 rounded text-gray-400 hover:text-primary-600 hover:bg-primary-500/10 transition-colors"
                            title="Open chart"
                        >
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M3 3v18h18" /><path d="M7 16l4-8 4 5 5-9" />
                            </svg>
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); onBuy?.(item.symbol); }}
                            className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/90 hover:bg-emerald-400 text-white transition-colors leading-none"
                        >
                            B
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); onSell?.(item.symbol); }}
                            className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-500/90 hover:bg-red-400 text-white transition-colors leading-none"
                        >
                            S
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); onRemove?.(item.id); }}
                            className="p-0.5 rounded text-gray-400 hover:text-red-500 transition-colors"
                            title="Remove"
                        >
                            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                <path d="M18 6L6 18M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                )}

                {/* Prices — always visible, never hidden */}
                <div className="flex flex-col items-end">
                    <span className="text-[13px] font-price font-semibold text-heading tabular-nums">
                        {price?.price != null ? formatPrice(price.price) : '—'}
                    </span>
                    <span className={cn(
                        'flex items-center gap-0.5 text-[10px] font-price tabular-nums',
                        changePositive ? 'text-bull' : 'text-bear'
                    )}>
                        <span className="text-[9px] leading-none">{changePositive ? '▲' : '▼'}</span>
                        {price?.change_percent != null
                            ? formatPercent(price.change_percent, 2)
                            : '—'}
                    </span>
                </div>
            </div>
        </div>
    );
}, (prev, next) =>
    prev.price?.price === next.price?.price &&
    prev.price?.change_percent === next.price?.change_percent &&
    prev.isSelected === next.isSelected &&
    prev.item.id === next.item.id
);

export default WatchlistItem;
