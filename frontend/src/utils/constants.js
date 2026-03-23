/** API base path (handled by Vite proxy / api.js baseURL) */
export const API_BASE = '/api';

/** LocalStorage keys */
export const LS_TOKEN = 'alphasync_token';
export const LS_USER = 'alphasync_user';
export const LS_THEME = 'alphasync_theme';
export const LS_SIDEBAR = 'alphasync_sidebar_collapsed';

/** WebSocket reconnect config */
export const WS_MAX_BACKOFF_MS = 30_000;
export const WS_HEARTBEAT_MS = 30_000;

/** Chart period → { period, interval } mapping (Zebu NorenOMS conventions)
 *  period:   how far back to fetch (days-based string for backend)
 *  interval: candle size passed to Zebu TPSeries / EODChartData
 */
export const CHART_PERIODS = {
    '1m': { period: '1d', interval: '1m', label: '1m', group: 'intraday' },
    '5m': { period: '1d', interval: '5m', label: '5m', group: 'intraday' },
    '15m': { period: '5d', interval: '15m', label: '15m', group: 'intraday' },
    '30m': { period: '5d', interval: '30m', label: '30m', group: 'intraday' },
    '1H': { period: '5d', interval: '1h', label: '1H', group: 'intraday' },
    '4H': { period: '1mo', interval: '1h', label: '4H', group: 'intraday' },
    '1D': { period: '1y', interval: '1d', label: '1D', group: 'daily' },
    '1W': { period: '2y', interval: '1wk', label: '1W', group: 'daily' },
    '1M': { period: '5y', interval: '1mo', label: '1M', group: 'daily' },
    '3M': { period: '3mo', interval: '1d', label: '3M', group: 'extended' },
    '6M': { period: '6mo', interval: '1d', label: '6M', group: 'extended' },
    '1Y': { period: '1y', interval: '1d', label: '1Y', group: 'extended' },
    '3Y': { period: '3y', interval: '1d', label: '3Y', group: 'extended' },
    '5Y': { period: '5y', interval: '1d', label: '5Y', group: 'extended' },
    'MAX': { period: 'max', interval: '1d', label: 'MAX', group: 'extended' },
};

/** Default chart period key */
export const DEFAULT_CHART_PERIOD = '5m';

/** Order sides */
export const ORDER_SIDE = { BUY: 'BUY', SELL: 'SELL' };

/** Order types */
export const ORDER_TYPE = {
    MARKET: 'MARKET',
    LIMIT: 'LIMIT',
    SL: 'SL',
    SL_M: 'SL-M',
};

/** Product types */
export const PRODUCT_TYPE = {
    CNC: 'CNC',
    MIS: 'MIS',
    NRML: 'NRML',
};

/**
 * Trading modes — mirrors how real Indian stock brokers (Zerodha, Groww,
 * Angel One, Upstox) present trading choices to users.
 *
 * DELIVERY (CNC)  → Buy & hold in demat. Sell only what you own. No leverage.
 * INTRADAY (MIS)  → Buy or short-sell first. Must square off same day by 3:15 PM.
 *                    Leveraged margin (typically 5×).
 */
export const TRADING_MODE = {
    DELIVERY: 'DELIVERY',
    INTRADAY: 'INTRADAY',
};

/** Maps trading mode → default product type */
export const TRADING_MODE_PRODUCT = {
    DELIVERY: 'CNC',
    INTRADAY: 'MIS',
};

/** Human-readable labels for each trading mode */
export const TRADING_MODE_INFO = {
    DELIVERY: {
        label: 'Delivery',
        sublabel: 'CNC',
    },
    INTRADAY: {
        label: 'Intraday',
        sublabel: 'MIS',
    },
};

/** Order status badge map */
export const ORDER_STATUS_CLASS = {
    COMPLETE: 'bg-green-500/10 text-green-400 border border-green-500/20',
    PENDING: 'bg-[#0EA5E9]/10 text-[#0EA5E9] border border-[#0EA5E9]/20',
    CANCELLED: 'bg-gray-500/10 text-gray-400 border border-gray-500/20',
    REJECTED: 'bg-red-500/10 text-red-500 border border-red-500/20',
    OPEN: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
};

/** Market session state labels */
export const MARKET_STATE_LABEL = {
    open: 'Market Open',
    pre_market: 'Pre-Market',
    closing: 'Closing',
    after_market: 'After Hours',
    weekend: 'Weekend',
    holiday: 'Holiday',
    closed: 'Market Closed',
};

/** Default watchlist symbols to seed a new account */
export const DEFAULT_WATCHLIST_SYMBOLS = [
    'RELIANCE.NS', 'TCS.NS', 'HDFCBANK.NS', 'INFY.NS', 'ICICIBANK.NS',
];

/** Sidebar widths */
export const SIDEBAR_EXPANDED_W = 240;
export const SIDEBAR_COLLAPSED_W = 72;
