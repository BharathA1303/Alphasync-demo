import { useEffect, useMemo, useRef, useState } from 'react';
import api from '../services/api';
import Modal from '../components/ui/Modal';
import Badge from '../components/ui/Badge';
import { useMarketIndicesStore } from '../stores/useMarketIndicesStore';
import { cn } from '../utils/cn';
import { formatCurrency, formatQuantity, formatPrice } from '../utils/formatters';
import { Search, LineChart } from 'lucide-react';

const FALLBACK_STOCKS = [
    'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK',
    'SBIN', 'LT', 'ITC', 'AXISBANK', 'HINDUNILVR',
];

const EXPIRIES = ['24-MAR-2026', '30-MAR-2026', '07-APR-2026', '13-APR-2026', '21-APR-2026', '28-APR-2026', '26-MAY-2026'];
const CHAIN_GRID_STYLE = { gridTemplateColumns: '1.4fr 1.4fr 1.2fr 1.4fr 1.4fr' };

const LOT_SIZE_MAP = {
    RELIANCE: 250,
    TCS: 150,
    HDFCBANK: 300,
    INFY: 300,
    ICICIBANK: 350,
    SBIN: 750,
    LT: 175,
    ITC: 1600,
    AXISBANK: 400,
    HINDUNILVR: 300,
};

const sanitizeSymbol = (symbol = '') => String(symbol).replace(/\.(NS|BO)$/i, '').trim().toUpperCase();

function symbolHash(input) {
    let hash = 0;
    const normalized = String(input || '');
    for (let index = 0; index < normalized.length; index += 1) {
        hash = (hash << 5) - hash + normalized.charCodeAt(index);
        hash |= 0;
    }
    return Math.abs(hash);
}

function lotSize(symbol) {
    return LOT_SIZE_MAP[symbol] || 250;
}

function priceStep(spotPrice) {
    if (spotPrice < 300) return 5;
    if (spotPrice < 1000) return 10;
    if (spotPrice < 3000) return 20;
    return 50;
}

function dummySpot(symbol) {
    const base = 120 + (symbolHash(symbol) % 4200);
    return Number((base + 0.35).toFixed(2));
}

function signedPercent(value) {
    const number = Number(value || 0);
    return `${number >= 0 ? '+' : ''}${number.toFixed(2)}%`;
}

function buildTenStrikeRows(symbol, spotPrice) {
    const step = priceStep(spotPrice);
    const atm = Math.round(spotPrice / step) * step;
    const rows = [];

    for (let index = -4; index <= 5; index += 1) {
        const strike = atm + index * step;
        const rowHash = symbolHash(`${symbol}-${strike}`);

        const callLtp = Number((Math.max(1, spotPrice - strike + (rowHash % 120) / 10 + 8)).toFixed(2));
        const putLtp = Number((Math.max(1, strike - spotPrice + (rowHash % 110) / 10 + 8)).toFixed(2));
        const callOi = 6000 + (rowHash % 140000);
        const putOi = 7000 + (rowHash % 150000);

        rows.push({
            strike,
            callLtp,
            putLtp,
            callOi,
            putOi,
            callLtpChangePct: Number((((rowHash % 240) - 120) / 45).toFixed(2)),
            putLtpChangePct: Number((((rowHash % 220) - 110) / 45).toFixed(2)),
            callOiChangePct: Number((((rowHash % 200) - 100) / 3.5).toFixed(2)),
            putOiChangePct: Number((((rowHash % 190) - 95) / 3.5).toFixed(2)),
            lot: lotSize(symbol),
        });
    }

    return rows;
}

function FuturesOrderModal({ isOpen, onClose, symbol, expiry, row, side }) {
    const [orderSide, setOrderSide] = useState(side || 'BUY');
    const [orderType, setOrderType] = useState('LIMIT');
    const [productType, setProductType] = useState('NRML');
    const [lots, setLots] = useState(1);
    const [limitPrice, setLimitPrice] = useState('');

    useEffect(() => {
        setOrderSide(side || 'BUY');
        setOrderType('LIMIT');
        setProductType('NRML');
        setLots(1);
        if (row) setLimitPrice(String(row.callLtp));
    }, [row, side]);

    if (!row) return null;

    const qty = lots * row.lot;
    const effectivePrice = Number(limitPrice || row.callLtp);
    const orderValue = qty * effectivePrice;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Futures Order" size="md">
            <div className="p-5 space-y-4">
                <div className="rounded-lg border border-edge/10 bg-surface-900/50 p-3">
                    <p className="text-xs text-gray-500">Contract</p>
                    <p className="text-sm font-semibold text-heading mt-1">{symbol} FUT {expiry}</p>
                    <p className="text-xs text-gray-500 mt-1">Strike {row.strike} • Lot {row.lot}</p>
                </div>

                <div className="flex rounded-xl overflow-hidden border border-edge/10 bg-surface-800/60 p-0.5">
                    {['BUY', 'SELL'].map((value) => (
                        <button
                            key={value}
                            onClick={() => setOrderSide(value)}
                            className={cn(
                                'flex-1 py-2 text-sm font-bold rounded-lg transition-all duration-200',
                                orderSide === value
                                    ? value === 'BUY' ? 'bg-bull text-white' : 'bg-bear text-white'
                                    : 'text-gray-500 hover:text-gray-700'
                            )}
                        >
                            {value}
                        </button>
                    ))}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                        <label className="metric-label block mb-1">Order Type</label>
                        <select
                            value={orderType}
                            onChange={(event) => setOrderType(event.target.value)}
                            className="w-full bg-surface-800/60 border border-edge/10 rounded-lg px-3 py-2 text-sm text-heading focus:outline-none"
                        >
                            <option value="LIMIT">LIMIT</option>
                            <option value="MARKET">MARKET</option>
                        </select>
                    </div>
                    <div>
                        <label className="metric-label block mb-1">Product</label>
                        <select
                            value={productType}
                            onChange={(event) => setProductType(event.target.value)}
                            className="w-full bg-surface-800/60 border border-edge/10 rounded-lg px-3 py-2 text-sm text-heading focus:outline-none"
                        >
                            <option value="NRML">NRML</option>
                            <option value="MIS">MIS</option>
                        </select>
                    </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                        <label className="metric-label block mb-1">Lots</label>
                        <input
                            type="number"
                            min={1}
                            value={lots}
                            onChange={(event) => setLots(Math.max(1, Number(event.target.value) || 1))}
                            className="w-full bg-surface-800/60 border border-edge/10 rounded-lg px-3 py-2 text-sm text-heading focus:outline-none"
                        />
                    </div>
                    <div>
                        <label className="metric-label block mb-1">Limit Price (₹)</label>
                        <input
                            type="number"
                            step="0.05"
                            value={limitPrice}
                            onChange={(event) => setLimitPrice(event.target.value)}
                            disabled={orderType === 'MARKET'}
                            className="w-full bg-surface-800/60 border border-edge/10 rounded-lg px-3 py-2 text-sm text-heading focus:outline-none disabled:opacity-60"
                        />
                    </div>
                </div>

                <div className="rounded-lg border border-edge/10 bg-surface-900/50 p-3 space-y-1.5">
                    <div className="flex justify-between text-xs">
                        <span className="text-gray-500">Quantity</span>
                        <span className="text-heading font-medium tabular-nums">{formatQuantity(qty)}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                        <span className="text-gray-500">Estimated Value</span>
                        <span className="text-heading font-medium tabular-nums">{formatCurrency(orderValue)}</span>
                    </div>
                </div>

                <button
                    type="button"
                    className={cn(
                        'w-full rounded-lg py-2.5 text-sm font-bold text-white transition-all',
                        orderSide === 'BUY' ? 'bg-bull hover:brightness-110' : 'bg-bear hover:brightness-110'
                    )}
                >
                    Place {orderSide} Order
                </button>
            </div>
        </Modal>
    );
}

export default function FuturesPage() {
    const tickerItems = useMarketIndicesStore((state) => state.tickerItems);
    const fetchTicker = useMarketIndicesStore((state) => state.fetchTicker);

    const [selectedExpiry, setSelectedExpiry] = useState(EXPIRIES[0]);
    const [selectedSymbol, setSelectedSymbol] = useState(FALLBACK_STOCKS[0]);

    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [showResults, setShowResults] = useState(false);

    const [orderPopup, setOrderPopup] = useState({ open: false, row: null, side: 'BUY' });

    const searchRef = useRef(null);

    useEffect(() => {
        fetchTicker();
    }, [fetchTicker]);

    const stockUniverse = useMemo(() => {
        const fromTicker = tickerItems
            .filter((item) => item.kind !== 'index')
            .map((item) => sanitizeSymbol(item.symbol || item.name));

        return [...FALLBACK_STOCKS, ...fromTicker]
            .filter(Boolean)
            .filter((value, index, self) => self.indexOf(value) === index)
            .sort((a, b) => a.localeCompare(b));
    }, [tickerItems]);

    useEffect(() => {
        if (!stockUniverse.includes(selectedSymbol)) {
            setSelectedSymbol(stockUniverse[0] || FALLBACK_STOCKS[0]);
        }
    }, [stockUniverse, selectedSymbol]);

    useEffect(() => {
        if (searchQuery.trim().length < 1) {
            setSearchResults(stockUniverse.slice(0, 100).map((symbol) => ({ symbol, name: symbol, exchange: 'NSE' })));
            return;
        }

        const localMatches = stockUniverse
            .filter((symbol) => symbol.includes(searchQuery.trim().toUpperCase()))
            .slice(0, 60)
            .map((symbol) => ({ symbol, name: symbol, exchange: 'NSE' }));

        const timeout = setTimeout(async () => {
            try {
                const response = await api.get(`/market/search?q=${encodeURIComponent(searchQuery.trim())}`);
                const apiResults = (response.data.results || []).map((item) => ({
                    symbol: sanitizeSymbol(item.symbol),
                    name: item.name || sanitizeSymbol(item.symbol),
                    exchange: item.exchange || 'NSE',
                }));

                const merged = [...apiResults, ...localMatches]
                    .filter((item) => item.symbol)
                    .filter((item, index, self) => self.findIndex((target) => target.symbol === item.symbol) === index)
                    .slice(0, 100);

                setSearchResults(merged);
            } catch {
                setSearchResults(localMatches);
            }
        }, 200);

        return () => clearTimeout(timeout);
    }, [searchQuery, stockUniverse]);

    useEffect(() => {
        const onOutside = (event) => {
            if (searchRef.current && !searchRef.current.contains(event.target)) {
                setShowResults(false);
            }
        };
        document.addEventListener('mousedown', onOutside);
        return () => document.removeEventListener('mousedown', onOutside);
    }, []);

    const spot = useMemo(() => dummySpot(selectedSymbol), [selectedSymbol]);
    const rows = useMemo(() => buildTenStrikeRows(selectedSymbol, spot), [selectedSymbol, spot]);

    const openOrderPopup = (row, side) => setOrderPopup({ open: true, row, side });

    return (
        <div className="p-4 lg:p-6 space-y-6 animate-fade-in">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-display font-semibold text-heading">Futures</h1>
                    <p className="text-gray-500 text-sm mt-0.5">Futures chain by selected stock</p>
                </div>
                <Badge variant="primary" className="font-semibold">Simulation Data Only</Badge>
            </div>

            <div className="glass-card p-3 lg:p-4">
                <div className="flex flex-wrap items-center gap-2 lg:gap-3">
                    <div className="relative w-full lg:w-[380px]" ref={searchRef}>
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(event) => setSearchQuery(event.target.value)}
                            onFocus={() => setShowResults(true)}
                            onKeyDown={(event) => {
                                if (event.key === 'Escape') {
                                    setShowResults(false);
                                    setSearchQuery('');
                                }
                            }}
                            placeholder="Search stocks… (e.g. RELIANCE, TCS)"
                            aria-label="Search futures stocks"
                            className={cn(
                                'w-full bg-surface-800/60 border border-edge/5 rounded-lg',
                                'pl-10 pr-3 py-2 text-sm text-heading placeholder-gray-500',
                                'focus:outline-none focus:border-primary-500/30 transition-all duration-200'
                            )}
                        />

                        {showResults && (
                            <div className="absolute top-full left-0 mt-1 w-full bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl shadow-2xl z-50 max-h-[320px] overflow-y-auto animate-slide-in">
                                {searchResults.length > 0 ? (
                                    searchResults.map((stock) => (
                                        <button
                                            key={stock.symbol}
                                            onClick={() => {
                                                const picked = sanitizeSymbol(stock.symbol);
                                                setSelectedSymbol(picked);
                                                setSearchQuery(picked);
                                                setShowResults(false);
                                            }}
                                            className="w-full text-left px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-slate-800 border-b border-gray-100 dark:border-slate-700 last:border-0 transition-colors"
                                        >
                                            <div className="flex items-center justify-between gap-3">
                                                <span className="text-sm font-semibold text-gray-900 dark:text-slate-100">{sanitizeSymbol(stock.symbol)}</span>
                                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300">
                                                    {stock.exchange || 'NSE'}
                                                </span>
                                            </div>
                                            <p className="text-xs text-gray-500 dark:text-slate-400 truncate">{stock.name || sanitizeSymbol(stock.symbol)}</p>
                                        </button>
                                    ))
                                ) : (
                                    <div className="px-4 py-3 text-center text-xs text-gray-500">No stocks found for "{searchQuery.trim()}"</div>
                                )}
                            </div>
                        )}
                    </div>

                    <select
                        value={selectedExpiry}
                        onChange={(event) => setSelectedExpiry(event.target.value)}
                        className="h-10 min-w-[180px] bg-surface-800/60 border border-edge/10 rounded-lg px-3 text-sm font-semibold text-heading focus:outline-none focus:border-primary-500/30"
                        aria-label="Select futures expiry"
                    >
                        {EXPIRIES.map((expiry) => (
                            <option key={expiry} value={expiry}>{expiry}</option>
                        ))}
                    </select>
                </div>
            </div>

            <div className="glass-card overflow-hidden">
                <div className="px-5 py-3 border-b border-edge/5">
                    <p className="text-sm font-semibold text-heading">{selectedSymbol} Futures Chain • {selectedExpiry}</p>
                    <p className="text-xs text-gray-500 mt-0.5">Click any searched stock to load its strike prices</p>
                </div>

                <div className="overflow-x-auto">
                    <div className="min-w-[820px]">
                        <div style={CHAIN_GRID_STYLE} className="grid border-b border-edge/5 text-center text-sm font-semibold text-gray-500 uppercase tracking-wider">
                            <div className="py-3 border-r border-edge/5" colSpan={2}>Calls</div>
                            <div className="py-3 border-r border-edge/5">Strikes</div>
                            <div className="py-3" colSpan={2}>Puts</div>
                        </div>

                        <div style={CHAIN_GRID_STYLE} className="grid border-b border-edge/5 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">
                            <div className="py-2 border-r border-edge/5">OI<br /><span className="normal-case text-[11px] font-medium">(OI ch)</span></div>
                            <div className="py-2 border-r border-edge/5">LTP<br /><span className="normal-case text-[11px] font-medium">(CH)</span></div>
                            <div className="py-2 border-r border-edge/5">Strike</div>
                            <div className="py-2 border-r border-edge/5">LTP<br /><span className="normal-case text-[11px] font-medium">(CH)</span></div>
                            <div className="py-2">OI<br /><span className="normal-case text-[11px] font-medium">(OI ch)</span></div>
                        </div>

                        <div className="divide-y divide-edge/[0.03]">
                            {rows.map((row) => (
                                <div key={row.strike} style={CHAIN_GRID_STYLE} className="grid text-center hover:bg-overlay/[0.03] transition-colors group">
                                    <div className="py-3 border-r border-edge/5">
                                        <p className="text-lg font-mono text-heading">{formatPrice(row.callOi / 1000)}</p>
                                        <p className={cn('text-sm font-medium', row.callOiChangePct >= 0 ? 'text-profit' : 'text-loss')}>
                                            ({signedPercent(row.callOiChangePct)})
                                        </p>
                                    </div>

                                    <div className="py-3 border-r border-edge/5">
                                        <p className="text-lg font-mono text-heading">{formatPrice(row.callLtp)}</p>
                                        <p className={cn('text-sm font-medium', row.callLtpChangePct >= 0 ? 'text-profit' : 'text-loss')}>
                                            ({signedPercent(row.callLtpChangePct)})
                                        </p>
                                    </div>

                                    <div className="py-3 border-r border-edge/5 relative flex flex-col items-center justify-center">
                                        <span className="text-xl font-semibold text-heading">{formatPrice(row.strike)}</span>
                                        <div className="absolute top-1 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                                            <button
                                                type="button"
                                                onClick={() => openOrderPopup(row, 'BUY')}
                                                className="w-6 h-6 rounded bg-bull text-white text-[10px] font-bold flex items-center justify-center"
                                                title="Buy"
                                            >
                                                B
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => openOrderPopup(row, 'SELL')}
                                                className="w-6 h-6 rounded bg-bear text-white text-[10px] font-bold flex items-center justify-center"
                                                title="Sell"
                                            >
                                                S
                                            </button>
                                            <button
                                                type="button"
                                                className="w-6 h-6 rounded bg-surface-800 text-gray-400 flex items-center justify-center border border-edge/10"
                                                title="Chart"
                                            >
                                                <LineChart className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    </div>

                                    <div className="py-3 border-r border-edge/5">
                                        <p className="text-lg font-mono text-heading">{formatPrice(row.putLtp)}</p>
                                        <p className={cn('text-sm font-medium', row.putLtpChangePct >= 0 ? 'text-profit' : 'text-loss')}>
                                            ({signedPercent(row.putLtpChangePct)})
                                        </p>
                                    </div>

                                    <div className="py-3">
                                        <p className="text-lg font-mono text-heading">{formatPrice(row.putOi / 1000)}</p>
                                        <p className={cn('text-sm font-medium', row.putOiChangePct >= 0 ? 'text-profit' : 'text-loss')}>
                                            ({signedPercent(row.putOiChangePct)})
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            <FuturesOrderModal
                isOpen={orderPopup.open}
                onClose={() => setOrderPopup({ open: false, row: null, side: 'BUY' })}
                symbol={selectedSymbol}
                expiry={selectedExpiry}
                row={orderPopup.row}
                side={orderPopup.side}
            />
        </div>
    );
}
