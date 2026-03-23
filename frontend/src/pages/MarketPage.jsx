import { useEffect } from 'react';
import { useMarketIndicesStore } from '../stores/useMarketIndicesStore';
import { TrendingUp, TrendingDown, BarChart3 } from 'lucide-react';
import { formatPrice, formatPercent, pnlColorClass } from '../utils/formatters';
import { Skeleton } from '../components/ui';
import { cn } from '../utils/cn';

export default function MarketPage() {
    const indices = useMarketIndicesStore((s) => s.indices);
    const isLoading = useMarketIndicesStore((s) => s.isLoading);
    const fetchIndices = useMarketIndicesStore((s) => s.fetchIndices);
    const startPolling = useMarketIndicesStore((s) => s.startPolling);
    const stopPolling = useMarketIndicesStore((s) => s.stopPolling);

    useEffect(() => {
        fetchIndices();
        startPolling();
        return () => stopPolling();
    }, [fetchIndices, startPolling, stopPolling]);

    return (
        <div className="p-4 lg:p-6 space-y-6 animate-fade-in">
            <div>
                <h1 className="text-2xl font-display font-semibold text-heading">Market</h1>
                <p className="text-gray-500 text-sm mt-0.5">Live market indices &amp; benchmarks</p>
            </div>

            {isLoading && indices.length === 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    <Skeleton variant="stat-card" count={6} />
                </div>
            ) : indices.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {indices.map((idx, i) => (
                        <div
                            key={i}
                            className="glass-card p-5 hover:border-primary-500/20 transition-all duration-300"
                        >
                            <div className="flex items-center justify-between mb-3">
                                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                    {idx.name}
                                </span>
                                <div className={cn(
                                    'p-1.5 rounded-lg',
                                    (idx.change ?? 0) >= 0 ? 'bg-emerald-500/10' : 'bg-red-500/10'
                                )}>
                                    {(idx.change ?? 0) >= 0
                                        ? <TrendingUp className="w-4 h-4 text-emerald-600" />
                                        : <TrendingDown className="w-4 h-4 text-red-500" />
                                    }
                                </div>
                            </div>
                            <div className="text-2xl font-mono font-semibold text-heading mb-1">
                                {Number(idx.price).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </div>
                            <div className={cn('flex items-center gap-2 text-sm font-mono', pnlColorClass(idx.change))}>
                                <span>{(idx.change ?? 0) > 0 ? '+' : ''}{formatPrice(idx.change)}</span>
                                <span className="opacity-70">({formatPercent(idx.change_percent)})</span>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="glass-card p-12 text-center">
                    <BarChart3 className="w-12 h-12 mx-auto mb-3 text-gray-600 opacity-40" />
                    <p className="text-sm font-medium text-gray-500">Market data unavailable</p>
                    <p className="text-xs text-gray-600 mt-1">Data refreshes during market hours (9:15 AM – 3:30 PM IST)</p>
                </div>
            )}
        </div>
    );
}
