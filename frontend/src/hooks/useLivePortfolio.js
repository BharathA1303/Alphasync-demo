import { useEffect, useRef } from 'react';
import { usePortfolioStore } from '../store/usePortfolioStore';
import { useMarketStore } from '../store/useMarketStore';
import api from '../services/api';

/**
 * Global polling hook — keeps portfolio P&L updated in real-time.
 *
 * Runs at AppShell level so it's always active regardless of which page
 * the user is on. Polls holding prices every 5s and applies them to both
 * the market store and portfolio store.
 *
 * This is the fallback when WebSocket is not connected ("Live (Fallback)" mode).
 */
export function useLivePortfolio() {
    const intervalRef = useRef(null);
    const refreshTimerRef = useRef(null);

    useEffect(() => {
        // Initial portfolio load to seed the store
        usePortfolioStore.getState().refreshPortfolio();

        const pollHoldingPrices = async () => {
            const { holdings, applyLiveQuote } = usePortfolioStore.getState();
            const { updateQuote } = useMarketStore.getState();

            if (!holdings || holdings.length === 0) return;

            const symbols = [...new Set(holdings.map((h) => h.symbol).filter(Boolean))];
            if (symbols.length === 0) return;

            try {
                const res = await api.get(`/market/batch?symbols=${encodeURIComponent(symbols.join(','))}`);
                const quotes = res.data?.quotes || {};

                // Update both market store and portfolio store for every symbol
                Object.entries(quotes).forEach(([symbol, quote]) => {
                    if (quote) {
                        updateQuote(symbol, quote);
                        applyLiveQuote(symbol, quote);
                    }
                });
            } catch {
                // Silently ignore — will retry on next interval
            }
        };

        // Poll immediately then every 5s
        pollHoldingPrices();
        intervalRef.current = setInterval(pollHoldingPrices, 5_000);

        // Also refresh full portfolio data every 30s (orders, summary, etc.)
        refreshTimerRef.current = setInterval(() => {
            usePortfolioStore.getState().refreshPortfolio();
        }, 30_000);

        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
            if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
        };
    }, []); // No reactive deps — reads from getState() to avoid re-renders in AppShell
}
