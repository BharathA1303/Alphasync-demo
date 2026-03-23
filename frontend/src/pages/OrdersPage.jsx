import { useState, useEffect, useMemo } from 'react';
import api from '../services/api';
import { BarChart3, Search } from 'lucide-react';
import { formatCurrency } from '../utils/formatters';
import { Skeleton } from '../components/ui';
import { cn } from '../utils/cn';

const ORDER_TABS = [
    { key: 'open', label: 'Open' },
    { key: 'trade', label: 'Trade' },
    { key: 'executed', label: 'Executed' },
];

const OPEN_STATUSES = new Set(['OPEN', 'PENDING', 'TRIGGER_PENDING', 'AMO_RECEIVED', 'MODIFY_PENDING']);
const EXECUTED_STATUSES = new Set(['FILLED', 'COMPLETE']);

const normalizeStatus = (status) => String(status || '').toUpperCase();
const normalizeSymbol = (symbol) => String(symbol || '').replace(/\.(NS|BO)$/i, '').trim();

export default function OrdersPage() {
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('trade');
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        const load = async () => {
            try {
                const res = await api.get('/orders');
                setOrders(res.data.orders || []);
            } catch { /* ignore */ }
            setLoading(false);
        };
        load();
    }, []);

    const tabCounts = useMemo(() => {
        const openCount = orders.filter((o) => OPEN_STATUSES.has(normalizeStatus(o.status))).length;
        const executedCount = orders.filter((o) => EXECUTED_STATUSES.has(normalizeStatus(o.status))).length;
        return {
            open: openCount,
            trade: orders.length,
            executed: executedCount,
        };
    }, [orders]);

    const tabOrders = useMemo(() => {
        if (activeTab === 'open') {
            return orders.filter((o) => OPEN_STATUSES.has(normalizeStatus(o.status)));
        }
        if (activeTab === 'executed') {
            return orders.filter((o) => EXECUTED_STATUSES.has(normalizeStatus(o.status)));
        }
        return orders;
    }, [orders, activeTab]);

    const visibleOrders = useMemo(() => {
        const query = searchQuery.trim().toUpperCase();
        if (!query) return tabOrders;
        return tabOrders.filter((o) => normalizeSymbol(o.symbol).toUpperCase().includes(query));
    }, [tabOrders, searchQuery]);

    const emptyMessage =
        searchQuery.trim().length > 0
            ? 'No matching stocks found in this section.'
            : activeTab === 'open'
                ? 'No open orders.'
                : activeTab === 'executed'
                    ? 'No executed orders yet.'
                    : 'No trade history yet.';

    if (loading) {
        return (
            <div className="p-4 lg:p-6 space-y-6">
                <Skeleton variant="text" className="h-8 w-48" />
                <Skeleton variant="table-row" count={8} />
            </div>
        );
    }

    return (
        <div className="p-4 lg:p-6 space-y-6 animate-fade-in">
            <div>
                <h1 className="text-2xl font-display font-semibold text-heading">Orders</h1>
                <p className="text-gray-500 text-sm mt-0.5">Your complete order history</p>
            </div>

            <div className="glass-card p-3 lg:p-4">
                <div className="flex flex-wrap items-center gap-2 lg:gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                        {ORDER_TABS.map((tab) => (
                            <button
                                key={tab.key}
                                type="button"
                                onClick={() => setActiveTab(tab.key)}
                                className={cn(
                                    'px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border',
                                    activeTab === tab.key
                                        ? 'bg-primary-500/15 text-primary-600 border-primary-500/30'
                                        : 'bg-surface-900/40 text-gray-500 border-edge/10 hover:text-heading hover:border-edge/20'
                                )}
                            >
                                {tab.label}
                                <span className="ml-1.5 text-[10px] font-mono tabular-nums opacity-80">{tabCounts[tab.key]}</span>
                            </button>
                        ))}
                    </div>

                    <div className="relative w-full lg:w-[360px] lg:ml-auto">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search stocks in orders…"
                        aria-label="Search orders by stock"
                        className={cn(
                            'w-full bg-surface-800/60 border border-edge/5 rounded-lg',
                            'pl-10 pr-3 py-2 text-sm text-heading placeholder-gray-500',
                            'focus:outline-none focus:border-primary-500/30 transition-all duration-200'
                        )}
                        />
                    </div>
                </div>
            </div>

            {visibleOrders.length > 0 ? (
                <div className="glass-card overflow-hidden">
                    {/* Table header */}
                    <div className="grid grid-cols-6 gap-4 px-5 py-3 border-b border-edge/5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                        <span>Symbol</span>
                        <span>Side</span>
                        <span>Qty</span>
                        <span>Price</span>
                        <span>Type</span>
                        <span className="text-right">Status</span>
                    </div>
                    {/* Table rows */}
                    <div className="divide-y divide-edge/[0.03]">
                        {visibleOrders.map((o, i) => (
                            <div key={i} className="grid grid-cols-6 gap-4 px-5 py-3.5 hover:bg-overlay/[0.03] transition-colors items-center">
                                <span className="text-sm font-semibold text-heading">{o.symbol?.replace('.NS', '')}</span>
                                <span className={cn(
                                    'text-xs font-semibold px-2.5 py-0.5 rounded w-fit',
                                    o.side === 'BUY' ? 'bg-bull/10 text-bull' : 'bg-bear/10 text-bear'
                                )}>
                                    {o.side}
                                </span>
                                <span className="text-sm font-mono text-gray-400">{o.quantity}</span>
                                <span className="text-sm font-mono font-semibold text-heading">{formatCurrency(o.filled_price ?? o.price)}</span>
                                <span className="text-xs text-gray-500">{o.product_type || o.order_type || '—'}</span>
                                <span className="text-right">
                                    <span className={cn(
                                        'text-[11px] px-2 py-0.5 rounded font-medium',
                                        EXECUTED_STATUSES.has(normalizeStatus(o.status)) ? 'text-profit bg-profit/10' :
                                            normalizeStatus(o.status) === 'CANCELLED' ? 'text-gray-400 bg-gray-400/10' :
                                                normalizeStatus(o.status) === 'REJECTED' || normalizeStatus(o.status) === 'EXPIRED' ? 'text-bear bg-bear/10' :
                                                'text-[#0EA5E9] bg-[#0EA5E9]/10'
                                    )}>
                                        {o.status}
                                    </span>
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            ) : (
                <div className="glass-card p-12 text-center">
                    <BarChart3 className="w-12 h-12 mx-auto mb-3 text-gray-600 opacity-30" />
                    <p className="text-sm font-medium text-gray-500">{emptyMessage}</p>
                    <p className="text-xs text-gray-600 mt-1">
                        {searchQuery.trim().length > 0
                            ? 'Try another symbol name.'
                            : 'Place your first trade from the terminal'}
                    </p>
                </div>
            )}
        </div>
    );
}
