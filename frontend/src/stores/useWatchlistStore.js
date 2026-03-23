import { create } from 'zustand';
import api from '../services/api';
import toast from 'react-hot-toast';

/**
 * Multi-watchlist store — supports unlimited watchlists per user.
 *
 * State shape:
 *   watchlists  — all watchlists [{id, name, items[]}]
 *   activeId    — currently viewed watchlist id
 *   prices      — symbol → quote (shared across all lists)
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
        set({ isLoading: true });
        try {
            const res = await api.get('/watchlist');
            const wls = res.data.watchlists || [];
            if (wls.length > 0) {
                set({ watchlists: wls, activeId: wls[0].id });
            } else {
                const created = await api.post('/watchlist', { name: 'My Watchlist' });
                const newWl = { ...created.data, items: [] };
                set({ watchlists: [newWl], activeId: newWl.id });
            }
        } catch { /* ignore */ } finally {
            set({ isLoading: false });
        }
    },

    // ── Switch active watchlist ───────────────────────────────────────────────
    setActiveWatchlist: (id) => {
        set({ activeId: id });
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
            toast.success('Watchlist deleted');
        } catch {
            set({ watchlists, activeId });
            toast.error('Failed to delete watchlist');
        }
    },

    // ── Add symbol to active watchlist (optimistic) ───────────────────────────
    // Optimistic update runs BEFORE the API call so the star turns gold instantly.
    addItem: async (symbol, exchange = 'NSE') => {
        const { activeId, watchlists } = get();
        if (!activeId) return;
        const active = watchlists.find(w => w.id === activeId);
        if (!active || active.items.some(i => i.symbol === symbol)) return;

        const tempId = `temp_${Date.now()}`;

        // ✅ Optimistic insert — UI reacts immediately, star goes gold before API
        set((s) => ({
            watchlists: s.watchlists.map(w =>
                w.id === activeId
                    ? { ...w, items: [...w.items, { id: tempId, symbol, exchange }] }
                    : w
            ),
        }));

        try {
            const res = await api.post(`/watchlist/${activeId}/items`, { symbol, exchange });
            // Swap temp record with real server record
            set((s) => ({
                watchlists: s.watchlists.map(w =>
                    w.id === activeId
                        ? { ...w, items: w.items.map(i => i.id === tempId ? res.data : i) }
                        : w
                ),
            }));
            // Fetch prices immediately so price shows without waiting for next poll
            get().fetchPrices();
            toast.success(`${symbol.replace('.NS', '')} added to watchlist`);
        } catch (err) {
            // Rollback on failure
            set((s) => ({
                watchlists: s.watchlists.map(w =>
                    w.id === activeId
                        ? { ...w, items: w.items.filter(i => i.id !== tempId) }
                        : w
                ),
            }));
            const detail = err.response?.data?.detail;
            const status = err.response?.status;
            toast.error(
                detail
                    ? `Failed to add symbol (${status ?? 'ERR'}): ${detail}`
                    : `Failed to add symbol (${status ?? 'ERR'})`
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
        try {
            await api.delete(`/watchlist/${activeId}/items/${itemId}`);
        } catch {
            set({ watchlists: snapshot });
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
    },

    // ── Fetch prices for active watchlist ─────────────────────────────────────
    fetchPrices: async () => {
        const { activeId, watchlists } = get();
        const active = watchlists.find(w => w.id === activeId);
        if (!active || active.items.length === 0) return;
        const symbols = active.items.map(w => w.symbol).join(',');
        try {
            const res = await api.get(`/market/batch?symbols=${encodeURIComponent(symbols)}`);
            set({ prices: res.data.quotes || {} });
        } catch { /* ignore */ }
    },

    updatePrices: (quotesMap) =>
        set((s) => ({ prices: { ...s.prices, ...quotesMap } })),
}));