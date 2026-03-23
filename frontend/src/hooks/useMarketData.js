import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../services/api';
import { useMarketStore } from '../store/useMarketStore';

/**
 * Fetch and manage market data for a given symbol.
 * Polls for quote updates at a configurable interval.
 *
 * @param {string} symbol - e.g. 'RELIANCE.NS'
 * @param {{ pollInterval?: number }} [options]
 * @returns {{
 *   quote: object|null,
 *   candles: Array,
 *   isLoading: boolean,
 *   hasError: boolean,
 *   refetch: () => void,
 * }}
 */
export function useMarketData(symbol, { pollInterval = 3_000 } = {}) {
    const [candles, setCandles] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [hasError, setHasError] = useState(false);

    const updateQuote = useMarketStore((s) => s.updateQuote);
    const quote = useMarketStore((s) => s.symbols[symbol] ?? null);

    // Track current symbol to prevent stale fetch results from overwriting
    const currentSymbolRef = useRef(symbol);
    currentSymbolRef.current = symbol;

    // AbortController ref for cancelling in-flight candle fetches
    const abortRef = useRef(null);

    const fetchQuote = useCallback(async () => {
        if (!symbol) return;
        try {
            const res = await api.get(`/market/quote/${encodeURIComponent(symbol)}`);
            // Only update if we got a valid quote with a price
            if (res.data && res.data.price != null && !res.data.error) {
                updateQuote(symbol, res.data);
                setHasError(false);
            }
        } catch {
            setHasError(true);
        }
    }, [symbol, updateQuote]);

    const fetchCandles = useCallback(async (period = '3mo', interval = '1d') => {
        if (!symbol) return;

        // Abort any previous in-flight candle fetch
        if (abortRef.current) {
            abortRef.current.abort();
        }
        const controller = new AbortController();
        abortRef.current = controller;

        const fetchSymbol = symbol;
        setIsLoading(true);
        try {
            const res = await api.get(
                `/market/history/${encodeURIComponent(symbol)}?period=${period}&interval=${interval}`,
                { signal: controller.signal }
            );
            // Only set data if this symbol is still the current one
            if (currentSymbolRef.current === fetchSymbol) {
                setCandles(res.data.candles || []);
            }
        } catch (err) {
            // Don't update state if aborted (symbol changed)
            if (err?.name === 'AbortError' || err?.code === 'ERR_CANCELED') return;
            // For other errors, clear candles so chart shows empty state
            if (currentSymbolRef.current === fetchSymbol) {
                setCandles([]);
            }
        } finally {
            if (currentSymbolRef.current === fetchSymbol) {
                setIsLoading(false);
            }
        }
    }, [symbol]);

    // On symbol change — clear stale candles and fetch fresh quote.
    // Candle loading is driven by TradingWorkspace's chartPeriod effect
    // so the correct period/interval is always used.
    useEffect(() => {
        if (!symbol) return;
        setCandles([]);
        setHasError(false);
        fetchQuote();

        // Abort any in-flight candle fetch for the previous symbol
        return () => {
            if (abortRef.current) {
                abortRef.current.abort();
            }
        };
    }, [symbol, fetchQuote]);

    // Polling
    const intervalRef = useRef(null);
    useEffect(() => {
        if (!symbol || pollInterval <= 0) return;
        intervalRef.current = setInterval(fetchQuote, pollInterval);
        return () => clearInterval(intervalRef.current);
    }, [symbol, pollInterval, fetchQuote]);

    return {
        quote,
        candles,
        isLoading,
        hasError,
        refetch: fetchQuote,
        fetchCandles,
    };
}
