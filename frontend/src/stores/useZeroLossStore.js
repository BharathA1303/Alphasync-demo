import { create } from 'zustand';
import api from '../services/api';

/**
 * ZeroLoss Strategy store — real-time state via WebSocket + REST fallback.
 *
 * WebSocket messages (channel: "zeroloss") update confidence, positions,
 * and stats in real time. REST calls provide initial load + history.
 */
export const useZeroLossStore = create((set, get) => ({
    // ── State ────────────────────────────────────────────────────────────────
    enabled: false,
    symbols: [],
    confidence: {},          // symbol → { score, direction, breakdown, ... }
    activePositions: {},     // symbol → position dict
    stats: {},               // { today_trades, today_profit, today_breakeven, today_pnl }
    signals: [],             // signal history
    performance: null,       // { records, summary }
    loading: true,
    lastUpdate: null,

    // ── REST Actions (initial load + manual refresh) ─────────────────────────

    fetchAll: async () => {
        try {
            const [statusRes, signalsRes, perfRes] = await Promise.allSettled([
                api.get('/zeroloss/status'),
                api.get('/zeroloss/signals?limit=50'),
                api.get('/zeroloss/performance?days=30'),
            ]);

            const update = { loading: false, lastUpdate: Date.now() };

            if (statusRes.status === 'fulfilled') {
                const d = statusRes.value.data;
                update.enabled = d.enabled;
                update.symbols = d.symbols || [];
                update.confidence = d.confidence || {};
                update.activePositions = d.active_positions || {};
                update.stats = d.stats || {};
            }
            if (signalsRes.status === 'fulfilled') {
                update.signals = signalsRes.value.data.signals || [];
            }
            if (perfRes.status === 'fulfilled') {
                update.performance = perfRes.value.data;
            }

            set(update);
        } catch (err) {
            console.error('ZeroLoss fetch error:', err);
            set({ loading: false });
        }
    },

    toggle: async () => {
        try {
            const res = await api.post('/zeroloss/toggle');
            set({ enabled: res.data.enabled });
            return res.data;
        } catch (err) {
            console.error('ZeroLoss toggle error:', err);
            throw err;
        }
    },

    // ── WebSocket Handlers (called from useWebSocket) ────────────────────────

    /** Handle any zeroloss channel message */
    handleWsMessage: (data) => {
        const msgType = data.type || data.data?.type;
        const payload = data.data || data;

        switch (msgType) {
            case 'confidence_update':
            case 'algo_signal': {
                // Update confidence for the symbol
                const conf = payload.confidence;
                if (conf?.symbol) {
                    set((state) => ({
                        confidence: {
                            ...state.confidence,
                            [conf.symbol]: conf,
                        },
                        stats: payload.stats || state.stats,
                        lastUpdate: Date.now(),
                    }));
                }
                break;
            }

            case 'algo_trade': {
                // Position entry or exit
                const action = payload.action;
                const signal = payload.signal;
                if (!signal?.symbol) break;

                if (action === 'ENTRY') {
                    set((state) => ({
                        activePositions: {
                            ...state.activePositions,
                            [signal.symbol]: signal,
                        },
                        stats: { ...state.stats, today_trades: (state.stats.today_trades || 0) + 1 },
                        lastUpdate: Date.now(),
                    }));
                } else if (action === 'EXIT' || action === 'FORCE_CLOSE') {
                    set((state) => {
                        const positions = { ...state.activePositions };
                        delete positions[signal.symbol];
                        const stats = { ...state.stats };
                        if (payload.reason === 'PROFIT') {
                            stats.today_profit = (stats.today_profit || 0) + 1;
                            stats.today_pnl = (stats.today_pnl || 0) + (payload.pnl || 0);
                        } else {
                            stats.today_breakeven = (stats.today_breakeven || 0) + 1;
                        }
                        return { activePositions: positions, stats, lastUpdate: Date.now() };
                    });
                }
                break;
            }

            default:
                // Update stats if present
                if (payload.stats) {
                    set({ stats: payload.stats, lastUpdate: Date.now() });
                }
        }
    },
}));
