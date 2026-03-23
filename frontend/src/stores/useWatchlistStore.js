import { create } from 'zustand';
import api from '../services/api';
import toast from 'react-hot-toast';

const STORAGE_KEY = 'alphasync_watchlists';

/**
 * Helper: Save watchlists to localStorage for persistence across refreshes
 */
const persistToStorage = (watchlists, activeId) => {
    try {
        console.log('[Watchlist] Persisting to localStorage:', { watchlists, activeId });
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ watchlists, activeId }));
        console.log('[Watchlist] Successfully persisted to localStorage');
    } catch (err) {
        console.error('[Watchlist] Failed to persist to localStorage:', err);
    }
};

/**
 * Helper: Load watchlists from localStorage
 */
const loadFromStorage = () => {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        console.log('[Watchlist] Loaded from localStorage:', stored);
        if (stored) {
            const parsed = JSON.parse(stored);
            console.log('[Watchlist] Parsed localStorage data:', parsed);
            return parsed;
        }
    } catch (err) {
        console.error('[Watchlist] Failed to load from localStorage:', err);
    }
    return null;
};

const toNumberOrNull = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
};

const ensureNsSuffix = (symbol = '') => {
    const base = String(symbol || '').trim();
    if (!base) return '';
    if (base.startsWith('^') || base.endsWith('.NS') || base.endsWith('.BO')) return base.toUpperCase();
    return `${base.toUpperCase()}.NS`;
};

const stripExchangeSuffix = (symbol = '') => String(symbol || '').replace(/\.(NS|BO)$/i, '').toUpperCase();

const normalizeQuote = (quote = {}) => {
    const prevClose = toNumberOrNull(
        quote.prev_close ?? quote.prevClose ?? quote.close ?? quote.pc
    );
    const price = toNumberOrNull(
        quote.price ?? quote.lp ?? quote.ltp ?? quote.last_price ?? quote.lastPrice
    );

    let change = toNumberOrNull(quote.change ?? quote.net_change ?? quote.netChange);
    let changePercent = toNumberOrNull(
        quote.change_percent ?? quote.changePercent ?? quote.pct_change ?? quote.pChange ?? quote.percent_change
    );

    if (change == null && price != null && prevClose != null) {
        change = price - prevClose;
    }

    if (changePercent == null && change != null && prevClose && prevClose !== 0) {
        changePercent = (change / prevClose) * 100;
    }

    return {
        ...quote,
        price: price ?? undefined,
        change: change ?? 0,
        change_percent: changePercent ?? 0,
        prev_close: prevClose ?? quote.prev_close ?? quote.close ?? 0,
    };
};

/**
 * Multi-watchlist store — supports unlimited watchlists per user.
 *
 * State shape:
 *   watchlists  — all watchlists [{id, name, items[]}]
 *   activeId    — currently viewed watchlist id
 *   prices      — symbol → quote (shared across all lists)
 *
 * Persistence: Uses localStorage to save watchlists across page refreshes.
 * Syncs with server on load and updates localStorage when successful.
 *
 * ⚠️  CRITICAL FIX: Removed JS getter syntax (get items(){}) from Zustand store.
 *     Zustand cannot track plain JS getters reactively — any component using them
 *     will NEVER re-render when underlying state changes (stale closure bug).
 *     Components must use proper Zustand selectors instead:
 *       const items = useWatchlistStore(s =>
 *         s.watchlists.find(w => w.id === s.activeId)?.items ?? []
 *       )
 */
export const useWatchlistStore = create((set, get) => ({
    /** @type {Array<{id:string, name:string, items:Array}>} */
    watchlists: [],

    /** @type {string|null} */
    activeId: null,

    /** @type {Record<string, object>} */
    prices: {},

    /** @type {boolean} */
    isLoading: false,

    // ── Load all watchlists on mount ──────────────────────────────────────────
    loadWatchlist: async () => {
        console.log('[Watchlist] loadWatchlist called');
        set({ isLoading: true });
        
        // 1. Try to load from localStorage first (fast cache)
        const cached = loadFromStorage();
        if (cached && cached.watchlists.length > 0) {
            console.log('[Watchlist] Using cached watchlists from localStorage');
            set({ watchlists: cached.watchlists, activeId: cached.activeId });
        }
        
        try {
            // 2. Try to sync with server
            console.log('[Watchlist] Attempting to sync with server');
            const res = await api.get('/watchlist');
            const wls = res.data.watchlists || [];
            console.log('[Watchlist] Got watchlists from server:', wls);
            if (wls.length > 0) {
                set({ watchlists: wls, activeId: wls[0].id });
                // Update localStorage with server data
                persistToStorage(wls, wls[0].id);
            } else {
                // Create default watchlist on server
                console.log('[Watchlist] No watchlists from server, creating default');
                const created = await api.post('/watchlist', { name: 'My Watchlist' });
                const newWl = { ...created.data, items: [] };
                set({ watchlists: [newWl], activeId: newWl.id });
                persistToStorage([newWl], newWl.id);
            }
        } catch (err) {
            console.error('[Watchlist] Server sync failed, using local fallback:', err);
            // On API error, use localStorage if available, otherwise create local fallback
            if (!cached || cached.watchlists.length === 0) {
                console.log('[Watchlist] Creating local fallback watchlist');
                const defaultId = `local_${Date.now()}`;
                const defaultWl = { id: defaultId, name: 'My Watchlist', items: [] };
                set({ watchlists: [defaultWl], activeId: defaultId });
                persistToStorage([defaultWl], defaultId);
            }
        } finally {
            set({ isLoading: false });
            console.log('[Watchlist] loadWatchlist completed, current state:', get());
        }
    },

    // ── Switch active watchlist ───────────────────────────────────────────────
    setActiveWatchlist: (id) => {
        set({ activeId: id });
        // Persist updated activeId
        const { watchlists, activeId } = get();
        persistToStorage(watchlists, activeId);
        get().fetchPrices();
    },

    // ── Create a new named watchlist ──────────────────────────────────────────
    createWatchlist: async (name = 'New Watchlist') => {
        const trimmed = name.trim();
        if (!trimmed) return null;
        try {
            const res = await api.post('/watchlist', { name: trimmed });
            const newWl = { ...res.data, items: [] };
            set((s) => ({
                watchlists: [...s.watchlists, newWl],
                activeId: newWl.id,
            }));
            // Persist after state update
            const { watchlists, activeId } = get();
            persistToStorage(watchlists, activeId);
            toast.success(`"${trimmed}" created`);
            return newWl;
        } catch (err) {
            toast.error(err.response?.data?.detail || 'Failed to create watchlist');
            return null;
        }
    },

    // ── Rename a watchlist (optimistic) ──────────────────────────────────────
    renameWatchlist: async (id, newName) => {
        const trimmed = newName?.trim();
        if (!id || !trimmed) return;
        set((s) => ({
            watchlists: s.watchlists.map(w =>
                w.id === id ? { ...w, name: trimmed } : w
            ),
        }));
        try {
            await api.patch(`/watchlist/${id}`, { name: trimmed });
            // Persist after successful rename
            const { watchlists, activeId } = get();
            persistToStorage(watchlists, activeId);
        } catch {
            get().loadWatchlist();
            toast.error('Failed to rename');
        }
    },

    // ── Delete a watchlist (optimistic, keeps at least 1) ────────────────────
    deleteWatchlist: async (id) => {
        const { watchlists, activeId } = get();
        if (watchlists.length <= 1) {
            toast.error('You need at least one watchlist');
            return;
        }
        const remaining = watchlists.filter(w => w.id !== id);
        const newActive = activeId === id ? remaining[0].id : activeId;
        set({ watchlists: remaining, activeId: newActive });
        try {
            await api.delete(`/watchlist/${id}`);
            // Persist after successful delete
            persistToStorage(remaining, newActive);
            toast.success('Watchlist deleted');
        } catch {
            set({ watchlists, activeId });
            toast.error('Failed to delete watchlist');
        }
    },

    // ── Add symbol to active watchlist (optimistic) ───────────────────────────
    // Optimistic update runs BEFORE the API call so the star turns gold instantly.
    addItem: async (symbol, exchange = 'NSE') => {
        console.log('[Watchlist] addItem called with:', { symbol, exchange });
        let { activeId, watchlists } = get();
        if (!activeId || watchlists.length === 0) {
            console.log('[Watchlist] No activeId, loading watchlist first');
            await get().loadWatchlist();
            ({ activeId, watchlists } = get());
        }
        if (!activeId || watchlists.length === 0) {
            console.error('[Watchlist] Still no activeId after loadWatchlist');
            toast.error('Cannot add to watchlist — initialization failed');
            return;
        }
        const active = watchlists.find(w => w.id === activeId);
        if (!active) {
            toast.error('Watchlist not found');
            return;
        }
        if (active.items.some(i => i.symbol === symbol)) {
            console.log('[Watchlist] Symbol already in watchlist, skipping');
            toast.info(`${symbol.replace('.NS', '')} is already in watchlist`);
            return;
        }

        const tempId = `temp_${Date.now()}`;

        // ✅ Optimistic insert — UI reacts immediately, star goes gold before API
        console.log('[Watchlist] Adding symbol optimistically:', { tempId, symbol });
        set((s) => ({
            watchlists: s.watchlists.map(w =>
                w.id === activeId
                    ? { ...w, items: [...w.items, { id: tempId, symbol, exchange }] }
                    : w
            ),
        }));

        // Persist optimistic state immediately
        let { watchlists: updatedWatchlists, activeId: updatedActiveId } = get();
        console.log('[Watchlist] State after optimistic add:', updatedWatchlists);
        persistToStorage(updatedWatchlists, updatedActiveId);

        toast.success(`${symbol.replace('.NS', '')} added to watchlist`);

        try {
            // If it's a local watchlist (id starts with 'local_'), skip server sync
            if (!activeId.startsWith('local_')) {
                console.log('[Watchlist] Syncing with server');
                const res = await api.post(`/watchlist/${activeId}/items`, { symbol, exchange });
                console.log('[Watchlist] Server response:', res.data);
                // Swap temp record with real server record if we get a real ID back
                if (res.data?.id) {
                    set((s) => ({
                        watchlists: s.watchlists.map(w =>
                            w.id === activeId
                                ? { ...w, items: w.items.map(i => i.id === tempId ? res.data : i) }
                                : w
                        ),
                    }));
                    // Persist after server sync
                    ({ watchlists: updatedWatchlists, activeId: updatedActiveId } = get());
                    persistToStorage(updatedWatchlists, updatedActiveId);
                }
            } else {
                console.log('[Watchlist] Using local watchlist, skipping server sync');
            }
            // Fetch prices immediately so price shows without waiting for next poll
            console.log('[Watchlist] Fetching prices after add');
            get().fetchPrices();
        } catch (err) {
            console.error('[Watchlist] Error during addItem:', err);
            // Rollback on failure
            set((s) => ({
                watchlists: s.watchlists.map(w =>
                    w.id === activeId
                        ? { ...w, items: w.items.filter(i => i.id !== tempId) }
                        : w
                ),
            }));
            // Persist rollback
            ({ watchlists: updatedWatchlists, activeId: updatedActiveId } = get());
            persistToStorage(updatedWatchlists, updatedActiveId);
            
            const detail = err.response?.data?.detail;
            const status = err.response?.status;
            toast.error(
                detail
                    ? `Failed to sync with server (${status ?? 'ERR'}): ${detail}`
                    : `Failed to sync with server (${status ?? 'ERR'})`
            );
        }
    },

    // ── Remove symbol from active watchlist (optimistic) ─────────────────────
    removeItem: async (itemId) => {
        const { activeId, watchlists } = get();
        if (!activeId) return;
        const snapshot = watchlists;
        set((s) => ({
            watchlists: s.watchlists.map(w =>
                w.id === activeId
                    ? { ...w, items: w.items.filter(i => i.id !== itemId) }
                    : w
            ),
        }));
        // Persist optimistic state
        let { watchlists: updatedWatchlists, activeId: updatedActiveId } = get();
        persistToStorage(updatedWatchlists, updatedActiveId);
        
        try {
            // If it's a local watchlist, skip server sync
            if (!activeId.startsWith('local_')) {
                await api.delete(`/watchlist/${activeId}/items/${itemId}`);
            }
            toast.success('Removed from watchlist');
        } catch (err) {
            set({ watchlists: snapshot });
            // Restore persisted state on error
            persistToStorage(snapshot, activeId);
            toast.error('Failed to remove symbol');
        }
    },

    // ── Reorder items in active watchlist (client-side) ─────────────────────────
    reorderItems: (fromIndex, toIndex) => {
        const { activeId, watchlists } = get();
        if (!activeId) return;
        const active = watchlists.find(w => w.id === activeId);
        if (!active) return;

        const newItems = [...active.items];
        const [moved] = newItems.splice(fromIndex, 1);
        newItems.splice(toIndex, 0, moved);

        set((s) => ({
            watchlists: s.watchlists.map(w =>
                w.id === activeId ? { ...w, items: newItems } : w
            ),
        }));
        // Persist reordered items
        const { watchlists: updatedWatchlists, activeId: updatedActiveId } = get();
        persistToStorage(updatedWatchlists, updatedActiveId);
    },

    // ── Fetch prices for active watchlist ─────────────────────────────────────
    fetchPrices: async () => {
        const { activeId, watchlists } = get();
        const active = watchlists.find(w => w.id === activeId);
        if (!active || active.items.length === 0) {
            console.log('[Watchlist] No items to fetch prices for');
            return;
        }
        
        // Build comma-separated symbol list, ensuring canonical suffix exists
        const symbolList = active.items
            .map(w => ensureNsSuffix(w.symbol))
            .filter(Boolean);

        const symbols = symbolList.join(',');
        
        if (!symbols) {
            console.log('[Watchlist] No symbols to fetch');
            return;
        }
        
        console.log('[Watchlist] Fetching prices for symbols:', symbols);
        
        const normalizedQuotes = {};
        const upsertQuote = (rawKey, rawValue) => {
            const quote = normalizeQuote(rawValue || {});
            const upperKey = String(rawKey || '').toUpperCase();
            const keyWithNs = ensureNsSuffix(upperKey);
            const keyWithoutNs = stripExchangeSuffix(upperKey);

            if (upperKey) normalizedQuotes[upperKey] = quote;
            if (keyWithNs) normalizedQuotes[keyWithNs] = quote;
            if (keyWithoutNs) normalizedQuotes[keyWithoutNs] = quote;

            const quoteSymbol = String(quote.symbol || '').toUpperCase();
            if (quoteSymbol) {
                const quoteWithNs = ensureNsSuffix(quoteSymbol);
                const quoteWithoutNs = stripExchangeSuffix(quoteSymbol);
                normalizedQuotes[quoteSymbol] = quote;
                if (quoteWithNs) normalizedQuotes[quoteWithNs] = quote;
                if (quoteWithoutNs) normalizedQuotes[quoteWithoutNs] = quote;
            }
        };

        try {
            const res = await api.get(`/market/batch?symbols=${encodeURIComponent(symbols)}`);
            const quotes = res.data.quotes || {};
            console.log('[Watchlist] Got batch quotes response:', quotes);
            Object.entries(quotes).forEach(([key, value]) => upsertQuote(key, value));
        } catch (err) {
            console.error('[Watchlist] Batch fetch failed, falling back to per-symbol quote API:', err.message, err);
        }

        // Fallback for symbols missing from /market/batch response
        const missingSymbols = symbolList.filter((sym) => {
            const withNs = ensureNsSuffix(sym);
            const withoutNs = stripExchangeSuffix(sym);
            return !(normalizedQuotes[withNs] || normalizedQuotes[withoutNs]);
        });

        if (missingSymbols.length > 0) {
            console.log('[Watchlist] Missing symbols after batch, fetching individually:', missingSymbols);
            const quoteResults = await Promise.allSettled(
                missingSymbols.map((sym) =>
                    api.get(`/market/quote/${encodeURIComponent(sym)}`)
                        .then((res) => ({ symbol: sym, quote: res.data }))
                )
            );

            quoteResults.forEach((result) => {
                if (result.status === 'fulfilled' && result.value?.quote) {
                    const { symbol, quote } = result.value;
                    upsertQuote(symbol, quote);
                }
            });
        }

        // Ensure every requested symbol has aliases so UI lookup always succeeds
        symbolList.forEach((sym) => {
            const withNs = ensureNsSuffix(sym);
            const withoutNs = stripExchangeSuffix(sym);
            const existing = normalizedQuotes[withNs] || normalizedQuotes[withoutNs] || normalizedQuotes[String(sym).toUpperCase()];
            if (existing) {
                normalizedQuotes[withNs] = existing;
                normalizedQuotes[withoutNs] = existing;
            }
        });

        console.log('[Watchlist] Final normalized prices:', normalizedQuotes);
        set({ prices: normalizedQuotes });
    },

    updatePrices: (quotesMap) =>
        set((s) => ({ prices: { ...s.prices, ...quotesMap } })),
}));