import { useEffect, useRef, useCallback } from 'react';
import { useMarketStore } from '../store/useMarketStore';
import { usePortfolioStore } from '../store/usePortfolioStore';
import { useWatchlistStore } from '../stores/useWatchlistStore';
import { useZeroLossStore } from '../stores/useZeroLossStore';
import api from '../services/api';
import { WS_MAX_BACKOFF_MS, WS_HEARTBEAT_MS } from '../utils/constants';

const WS_FALLBACK_POLL_MS = 2500;

/**
 * WebSocket hook for real-time market data.
 *
 * Handles:
 * - Auto reconnect with exponential backoff (cap 30s)
 * - Heartbeat pings every 30s
 * - Subscription model: subscribe/unsubscribe to symbol lists
 * - Queues subscriptions made while disconnected
 * - Exposes connection status for UI indicators
 *
 * @returns {{
 *   status: 'connecting'|'connected'|'disconnected'|'error',
 *   subscribe: (symbols: string[]) => void,
 *   unsubscribe: (symbols: string[]) => void,
 * }}
 */
export function useWebSocket() {
    const wsRef = useRef(null);
    const statusRef = useRef('disconnected');
    const backoffRef = useRef(1000);
    const failedAttemptsRef = useRef(0);
    const reconnectTimer = useRef(null);
    const heartbeatTimer = useRef(null);
    const fallbackPollTimer = useRef(null);
    const messageQueue = useRef([]);   // queued while disconnected
    const mountedRef = useRef(true);

    const updateQuote = useMarketStore((s) => s.updateQuote);
    const setWsStatus = useMarketStore((s) => s.setWsStatus);
    const selectedSymbol = useMarketStore((s) => s.selectedSymbol);
    const holdings = usePortfolioStore((s) => s.holdings);
    const applyLiveQuote = usePortfolioStore((s) => s.applyLiveQuote);
    const refreshPortfolio = usePortfolioStore((s) => s.refreshPortfolio);
    const portfolioRefreshTimer = useRef(null);
    const watchlists = useWatchlistStore((s) => s.watchlists);
    const activeWatchlistId = useWatchlistStore((s) => s.activeId);
    const handleZeroLoss = useZeroLossStore((s) => s.handleWsMessage);

    const normalizeSymbol = useCallback((symbol) => {
        if (!symbol || typeof symbol !== 'string') return null;
        if (symbol.startsWith('^') || symbol.endsWith('.NS') || symbol.endsWith('.BO')) {
            return symbol;
        }
        return `${symbol}.NS`;
    }, []);

    const getTrackedSymbols = useCallback(() => {
        const activeWatchlist = watchlists.find((w) => w.id === activeWatchlistId);
        const watchlistSymbols = (activeWatchlist?.items || []).map((item) => item.symbol);
        const holdingSymbols = (holdings || []).map((h) => h.symbol);

        return [
            ...(selectedSymbol ? [selectedSymbol] : []),
            ...watchlistSymbols,
            ...holdingSymbols,
        ]
            .map(normalizeSymbol)
            .filter(Boolean)
            .filter((value, index, arr) => arr.indexOf(value) === index);
    }, [selectedSymbol, watchlists, activeWatchlistId, holdings, normalizeSymbol]);

    const applyIncomingQuote = useCallback((symbol, data = {}) => {
        if (!symbol) return;
        const normalizedSymbol = normalizeSymbol(symbol);
        const resolvedPrice = Number(
            data.price ?? data.lp ?? data.ltp ?? data.last_price
        );

        const quoteData = { ...data };
        if (Number.isFinite(resolvedPrice) && resolvedPrice > 0) {
            quoteData.price = resolvedPrice;
        }

        const key = normalizedSymbol || symbol;
        updateQuote(key, quoteData);
        applyLiveQuote(key, quoteData);

        if (normalizedSymbol && normalizedSymbol !== symbol) {
            updateQuote(symbol, quoteData);
        }
    }, [normalizeSymbol, updateQuote, applyLiveQuote]);

    const stopFallbackPolling = useCallback(() => {
        if (fallbackPollTimer.current) {
            clearInterval(fallbackPollTimer.current);
            fallbackPollTimer.current = null;
        }
    }, []);

    const pollQuotesFallback = useCallback(async () => {
        const symbols = getTrackedSymbols();
        if (symbols.length === 0) return;

        try {
            const res = await api.get(`/market/batch?symbols=${encodeURIComponent(symbols.join(','))}`);
            const quotes = res.data?.quotes || {};
            Object.entries(quotes).forEach(([symbol, quote]) => {
                applyIncomingQuote(symbol, quote || {});
            });
        } catch {
            // Ignore fallback polling errors; websocket reconnect continues in parallel.
        }
    }, [getTrackedSymbols, applyIncomingQuote]);

    const ensureFallbackPolling = useCallback(() => {
        if (fallbackPollTimer.current) return;
        fallbackPollTimer.current = setInterval(pollQuotesFallback, WS_FALLBACK_POLL_MS);
    }, [pollQuotesFallback]);

    const send = useCallback((payload) => {
        const msg = JSON.stringify(payload);
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(msg);
        } else {
            // Queue for when connection is established
            messageQueue.current.push(msg);
        }
    }, []);

    const flushQueue = useCallback(() => {
        while (messageQueue.current.length > 0 && wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(messageQueue.current.shift());
        }
    }, []);

    const startHeartbeat = useCallback(() => {
        if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
        heartbeatTimer.current = setInterval(() => {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ type: 'ping' }));
            }
        }, WS_HEARTBEAT_MS);
    }, []);

    const connect = useCallback(() => {
        if (!mountedRef.current) return;
        if (wsRef.current?.readyState === WebSocket.OPEN ||
            wsRef.current?.readyState === WebSocket.CONNECTING) return;

        // Resolve WebSocket URL from current host, include JWT for auth
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        const token = localStorage.getItem('alphasync_token');
        // Generate unique client ID per connection to avoid server-side collisions
        const clientId = `market_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const url = token
            ? `${protocol}//${host}/ws/${clientId}?token=${encodeURIComponent(token)}`
            : `${protocol}//${host}/ws/${clientId}`;

        statusRef.current = 'connecting';
        setWsStatus('connecting');

        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
            if (!mountedRef.current) { ws.close(); return; }
            backoffRef.current = 1000; // reset backoff on success
            failedAttemptsRef.current = 0;
            statusRef.current = 'connected';
            setWsStatus('connected');
            startHeartbeat();
            stopFallbackPolling();
            flushQueue(); // drain queued messages
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                // Handle real-time quote updates from Zebu
                if (data.type === 'quote' && data.symbol) {
                    const { type, channel, ...quoteData } = data;
                    applyIncomingQuote(data.symbol, quoteData);
                }
                // Backward compat: also handle "price_update" type (legacy format)
                if (data.type === 'price_update' && data.data?.symbol) {
                    const { type: _t, channel: _c, ...legacyData } = data.data;
                    applyIncomingQuote(data.data.symbol, legacyData);
                }
                // Route zeroloss channel messages to the zeroloss store
                if (data.channel === 'zeroloss') {
                    handleZeroLoss(data);
                }
                // Refresh portfolio/orders when order events or portfolio updates arrive
                if (
                    data.channel === 'orders' ||
                    data.channel === 'portfolio' ||
                    data.type === 'portfolio_update'
                ) {
                    if (portfolioRefreshTimer.current) clearTimeout(portfolioRefreshTimer.current);
                    portfolioRefreshTimer.current = setTimeout(() => refreshPortfolio(), 500);
                }
                // pong / other message types can be handled here
            } catch { /* malformed JSON — ignore */ }
        };

        ws.onerror = () => {
            statusRef.current = 'error';
            setWsStatus('error');
        };

        ws.onclose = () => {
            if (!mountedRef.current) return;
            statusRef.current = 'disconnected';
            setWsStatus('disconnected');
            if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
            ensureFallbackPolling();

            failedAttemptsRef.current += 1;

            // Exponential backoff reconnect
            const delay = Math.min(backoffRef.current, WS_MAX_BACKOFF_MS);
            backoffRef.current = Math.min(backoffRef.current * 2, WS_MAX_BACKOFF_MS);
            reconnectTimer.current = setTimeout(connect, delay);
        };
    }, [flushQueue, setWsStatus, startHeartbeat, stopFallbackPolling, applyIncomingQuote, handleZeroLoss, refreshPortfolio, ensureFallbackPolling]);

    useEffect(() => {
        mountedRef.current = true;
        connect();
        return () => {
            mountedRef.current = false;
            if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
            if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
            stopFallbackPolling();
            wsRef.current?.close();
        };
    }, [connect, stopFallbackPolling]);

    useEffect(() => {
        const symbols = getTrackedSymbols();

        if (symbols.length > 0) {
            send({ type: 'subscribe', symbols: [...new Set(symbols)] });
        }
    }, [getTrackedSymbols, send]);

    useEffect(() => {
        if (statusRef.current === 'connected') {
            stopFallbackPolling();
            return;
        }

        ensureFallbackPolling();
        pollQuotesFallback();

        return () => stopFallbackPolling();
    }, [ensureFallbackPolling, pollQuotesFallback, stopFallbackPolling, selectedSymbol, holdings, watchlists, activeWatchlistId]);

    const subscribe = useCallback((symbols) => {
        send({ type: 'subscribe', symbols });
    }, [send]);

    const unsubscribe = useCallback((symbols) => {
        send({ type: 'unsubscribe', symbols });
    }, [send]);

    // Return the current status from store (reactive)
    const status = useMarketStore((s) => s.wsStatus);
    return { status, subscribe, unsubscribe };
}
