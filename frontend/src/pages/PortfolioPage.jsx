import { useEffect } from 'react';
import { usePortfolioStore } from '../store/usePortfolioStore';
import PortfolioSummary from '../components/portfolio/PortfolioSummary';
import HoldingsTable from '../components/portfolio/HoldingsTable';
import ErrorBoundary from '../components/ErrorBoundary';

/**
 * Portfolio page — summary stats + holdings table.
 * Data managed via Zustand usePortfolioStore (refreshed on mount).
 */
export default function PortfolioPage() {
    const { summary, holdings, isLoading, refreshPortfolio } = usePortfolioStore();

    useEffect(() => {
        refreshPortfolio();
    }, [refreshPortfolio]);

    return (
        <div className="p-4 lg:p-6 space-y-6 animate-fade-in">
            <div>
                <h1 className="text-2xl font-display font-semibold text-heading">Portfolio</h1>
                <p className="text-gray-500 text-sm mt-0.5">Track your holdings and performance</p>
            </div>
            <PortfolioSummary summary={summary} isLoading={isLoading} />
            <ErrorBoundary fallback="Holdings table failed to load.">
                <HoldingsTable holdings={holdings} isLoading={isLoading} />
            </ErrorBoundary>
        </div>
    );
}

