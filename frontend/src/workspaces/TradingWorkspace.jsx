// ─── TradingWorkspace ────────────────────────────────────────────────────────
// CSS Grid layout: Watchlist | (ChartHeader + Chart + BottomDock) | OrderPanel
// + floating StrategyDock
// Responsive: Desktop grid → Tablet (no watchlist) → Mobile (drawers + trade bar)
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { usePortfolioStore } from '../store/usePortfolioStore';
import { useMarketStore } from '../store/useMarketStore';
import { useWatchlistStore } from '../stores/useWatchlistStore';
import { useStrategyStore } from '../stores/useStrategyStore';
import { useMarketData } from '../hooks/useMarketData';
import { useBreakpoint } from '../hooks/useBreakpoint';
import ChartHeader from '../components/trading/ChartHeader';
import ZebuLiveChart from '../components/trading/ZebuLiveChart';
import Watchlist from '../components/trading/Watchlist';
import OrderPanel from '../components/trading/OrderPanel';
import ResizablePanel from '../components/layout/ResizablePanel';
import ResponsiveDrawer from '../components/layout/ResponsiveDrawer';
import DockContainer from '../components/layout/DockContainer';
import MobileTradeBar from '../components/layout/MobileTradeBar';
import { PositionsPanel, OrderHistoryPanel } from '../panels';
import { StrategyDock } from '../strategy/components';
import { runEngine, getAvailableStrategies } from '../strategy';
import Modal from '../components/ui/Modal';
import ErrorBoundary from '../components/ErrorBoundary';
import { cn } from '../utils/cn';
import { CHART_PERIODS, DEFAULT_CHART_PERIOD } from '../utils/constants';
import { useZeroLossStore } from '../stores/useZeroLossStore';
import { PanelLeftOpen, PanelLeftClose, PanelRightOpen, PanelRightClose } from 'lucide-react';

// ── Main workspace ───────────────────────────────────────────────────────────
export default function TradingWorkspace() {
    const [searchParams] = useSearchParams();
    const initialSymbol = searchParams.get('symbol') || 'RELIANCE.NS';

    const [selectedSymbol, setSelectedSymbol] = useState(initialSymbol);
    const [chartPeriod, setChartPeriod] = useState(DEFAULT_CHART_PERIOD);
    const [isTerminalFocused, setIsTerminalFocused] = useState(false);
    const [strategyDockOpen, setStrategyDockOpen] = useState(false);
    const [watchlistToggleBusy, setWatchlistToggleBusy] = useState(false);
    const [bottomCollapsed, setBottomCollapsed] = useState(false);
    const [watchlistVisible, setWatchlistVisible] = useState(true);
    const [orderPanelVisible, setOrderPanelVisible] = useState(true);

    // Sync selectedSymbol when URL ?symbol= changes (e.g. ticker bar click)
    useEffect(() => {
        const urlSymbol = searchParams.get('symbol');
        if (urlSymbol && urlSymbol !== selectedSymbol) {
            setSelectedSymbol(urlSymbol);
        }
    }, [searchParams]);

    // Responsive drawer states
    const [watchlistDrawerOpen, setWatchlistDrawerOpen] = useState(false);
    const [orderDrawerOpen, setOrderDrawerOpen] = useState(false);

    // Breakpoint
    const { isMobile, isCompact, isWide } = useBreakpoint();

    // ── Stores ────────────────────────────────────────────────────────────────
    const { holdings, orders, refreshPortfolio } = usePortfolioStore();
    const setGlobalSelectedSymbol = useMarketStore((s) => s.setSelectedSymbol);
    const batchUpdateQuotes = useMarketStore((s) => s.batchUpdateQuotes);

    // ── Watchlist store — FIX: use proper reactive selectors, NOT broken JS getters ──
    // The store previously had `get items()` and `get watchlistId()` as JS getters.
    // Those were removed. Now we must select raw state and derive what we need.
    const watchlists = useWatchlistStore((s) => s.watchlists);
    const activeId = useWatchlistStore((s) => s.activeId);
    const watchlistPrices = useWatchlistStore((s) => s.prices);
    const loadWatchlist = useWatchlistStore((s) => s.loadWatchlist);
    const fetchWatchlistPrices = useWatchlistStore((s) => s.fetchPrices);
    const addWatchlistItem = useWatchlistStore((s) => s.addItem);
    const removeWatchlistItem = useWatchlistStore((s) => s.removeItem);

    // Derive items safely — only recomputes when watchlists/activeId actually change
    const watchlistItems = useMemo(
        () => watchlists.find(w => w.id === activeId)?.items ?? [],
        [watchlists, activeId]
    );

    const currentWatchlistItem = useMemo(() => {
        if (!selectedSymbol) return null;
        return watchlistItems.find((item) =>
            String(item.symbol || '').toUpperCase() === String(selectedSymbol).toUpperCase()
        ) || null;
    }, [watchlistItems, selectedSymbol]);

    // Strategy store — the StrategyDock writes engine output here;
    // the chart badge reads it so both always show the same result.
    const engineOutput = useStrategyStore((s) => s.engineOutput);
    const setEngineOutput = useStrategyStore((s) => s.setEngineOutput);

    // ── Hooks ─────────────────────────────────────────────────────────────────
    const { quote, candles, isLoading: chartLoading, fetchCandles } = useMarketData(selectedSymbol);

    const zlConfidence = useZeroLossStore((s) => s.confidence[selectedSymbol] || null);
    const allSymbolQuotes = useMarketStore((s) => s.symbols);

    // ── Derived: Trend data from the shared strategy store ─────────────────
    // The StrategyDock computes engine results with user-enabled strategies
    // and writes them to the store. We read from the store here so the chart
    // badge always matches the dock. If the dock hasn't run yet (e.g. first
    // load), compute a fallback with all strategies.
    const trendData = useMemo(() => {
        if (engineOutput && engineOutput.signals?.length > 0) {
            return {
                overall: engineOutput.overall,
                confidence: engineOutput.confidence,
                weightedScore: engineOutput.weightedScore ?? 0,
            };
        }
        // Fallback: compute with all strategies if dock hasn't run yet
        if (!candles || candles.length === 0) return null;
        const strategies = getAvailableStrategies();
        const enabledIds = strategies.map((s) => s.id);
        const result = runEngine(candles, enabledIds);
        return {
            overall: result.overall,
            confidence: result.confidence,
            weightedScore: result.weightedScore ?? 0,
        };
    }, [engineOutput, candles, setEngineOutput]);

    // ── Effects ───────────────────────────────────────────────────────────────
    useEffect(() => {
        const cfg = CHART_PERIODS[chartPeriod] || CHART_PERIODS[DEFAULT_CHART_PERIOD];
        fetchCandles(cfg.period, cfg.interval);
    }, [selectedSymbol, chartPeriod, fetchCandles]);

    useEffect(() => { refreshPortfolio(); }, [refreshPortfolio]);
    useEffect(() => { loadWatchlist(); }, [loadWatchlist]);
    useEffect(() => { setGlobalSelectedSymbol(selectedSymbol); }, [selectedSymbol, setGlobalSelectedSymbol]);

    // FIX: watchlistItems is now always a valid array (never undefined),
    // so .length is safe. Poll every 5s for faster price updates.
    useEffect(() => {
        if (watchlistItems.length === 0) return;
        fetchWatchlistPrices();
        const id = setInterval(fetchWatchlistPrices, 2_000);
        return () => clearInterval(id);
    }, [watchlistItems, fetchWatchlistPrices]);

    useEffect(() => {
        if (Object.keys(watchlistPrices).length > 0) {
            batchUpdateQuotes(watchlistPrices);
        }
    }, [watchlistPrices, batchUpdateQuotes]);

    // Close drawers on breakpoint change to desktop
    useEffect(() => {
        if (isWide) {
            setWatchlistDrawerOpen(false);
            setOrderDrawerOpen(false);
        }
    }, [isWide]);

    // ── Handlers ──────────────────────────────────────────────────────────────
    const [orderSide, setOrderSide] = useState(null);
    const [orderSideKey, setOrderSideKey] = useState(0);

    // Quick order modal — opens when SELL/EXIT/BUY is clicked from positions
    const [quickOrderOpen, setQuickOrderOpen] = useState(false);
    const [quickOrderSymbol, setQuickOrderSymbol] = useState(null);
    const [quickOrderSide, setQuickOrderSide] = useState(null);
    const [quickOrderKey, setQuickOrderKey] = useState(0);

    const handleSelectSymbol = useCallback((symbol) => {
        setSelectedSymbol(symbol);
        if (isCompact) setWatchlistDrawerOpen(false);
    }, [isCompact]);

    const handleToggleWatchlist = useCallback(async () => {
        if (!selectedSymbol || watchlistToggleBusy) return;
        setWatchlistToggleBusy(true);
        try {
            if (currentWatchlistItem?.id) {
                await removeWatchlistItem(currentWatchlistItem.id);
            } else {
                await addWatchlistItem(selectedSymbol, 'NSE');
            }
        } finally {
            setWatchlistToggleBusy(false);
        }
    }, [selectedSymbol, watchlistToggleBusy, currentWatchlistItem, addWatchlistItem, removeWatchlistItem]);

    const handleBuy = useCallback(() => {
        setOrderSide('BUY');
        setOrderSideKey((k) => k + 1);
        setOrderDrawerOpen(true);
    }, []);

    const handleSell = useCallback(() => {
        setOrderSide('SELL');
        setOrderSideKey((k) => k + 1);
        setOrderDrawerOpen(true);
    }, []);

    // Position SELL/EXIT → open quick order popup modal
    const handlePositionSell = useCallback((symbol) => {
        setQuickOrderSymbol(symbol);
        setQuickOrderSide('SELL');
        setQuickOrderKey((k) => k + 1);
        setQuickOrderOpen(true);
    }, []);

    const handlePositionBuy = useCallback((symbol) => {
        setQuickOrderSymbol(symbol);
        setQuickOrderSide('BUY');
        setQuickOrderKey((k) => k + 1);
        setQuickOrderOpen(true);
    }, []);

    // ── Handle bottom panel collapse/expand ────────────────────────────────────
    const handleBottomPanelToggle = useCallback(() => {
        setBottomCollapsed((v) => !v);
        // Trigger chart resize after layout transition completes
        setTimeout(() => {
            window.dispatchEvent(new Event('resize'));
        }, 250);
    }, []);

    // ── Dock tabs ─────────────────────────────────────────────────────────────
    const dockTabs = useMemo(() => [
        {
            key: 'positions',
            label: 'Positions',
            count: holdings.length,
            content: <PositionsPanel showHeader={false} holdings={holdings} onSell={handlePositionSell} onBuy={handlePositionBuy} />,
        },
        {
            key: 'orders',
            label: 'Orders',
            count: orders.length,
            content: <OrderHistoryPanel showHeader={false} orders={orders} />,
        },
    ], [holdings, orders]);

    // ── Shared watchlist element ───────────────────────────────────────────────
    // NOTE: Watchlist now reads everything from useWatchlistStore internally.
    // We no longer need to pass items/prices/watchlistId as props.
    const watchlistEl = (
        <Watchlist
            selectedSymbol={selectedSymbol}
            onSelectSymbol={handleSelectSymbol}
            onBuy={handlePositionBuy}
            onSell={handlePositionSell}
        />
    );

    const orderPanelEl = (
        <OrderPanel
            symbol={selectedSymbol}
            currentPrice={quote?.price ?? 0}
            isTerminalFocused={isTerminalFocused}
            initialSide={orderSide}
            initialSideKey={orderSideKey}
        />
    );

    return (
        <div
            className="terminal-grid h-[calc(100vh-56px-36px)]"
            onFocus={() => setIsTerminalFocused(true)}
            onBlur={() => setIsTerminalFocused(false)}
        >
            {/* ── WATCHLIST AREA ─────────────────────────────────────── */}
            {isWide ? (
                watchlistVisible ? (
                    <ResizablePanel
                        side="left"
                        defaultSize={260}
                        minSize={200}
                        maxSize={400}
                        className="terminal-area-watchlist hidden lg:flex"
                    >
                        {watchlistEl}
                    </ResizablePanel>
                ) : null
            ) : (
                <ResponsiveDrawer
                    open={watchlistDrawerOpen}
                    onClose={() => setWatchlistDrawerOpen(false)}
                    side="left"
                    isCompact={true}
                    width="w-[280px]"
                >
                    {watchlistEl}
                </ResponsiveDrawer>
            )}

            {/* ── CHART HEADER AREA ─────────────────────────────────── */}
            <div className="terminal-area-header min-w-0 flex items-center">
                {/* Watchlist toggle — desktop only */}
                {isWide && (
                    <button
                        onClick={() => {
                            setWatchlistVisible((v) => !v);
                            setTimeout(() => window.dispatchEvent(new Event('resize')), 250);
                        }}
                        className={cn(
                            "flex-shrink-0 p-1.5 ml-1 rounded-md transition-all duration-200",
                            "text-slate-400 hover:text-heading hover:bg-overlay/[0.06]",
                            !watchlistVisible && "text-primary-500 bg-primary-500/10"
                        )}
                        title={watchlistVisible ? "Hide watchlist" : "Show watchlist"}
                    >
                        {watchlistVisible ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
                    </button>
                )}
                <div className="flex-1 min-w-0">
                    <ChartHeader
                        symbol={selectedSymbol}
                        quote={quote}
                        period={chartPeriod}
                        onPeriodChange={setChartPeriod}
                        strategyDockOpen={strategyDockOpen}
                        isWatchlisted={Boolean(currentWatchlistItem)}
                        onToggleWatchlist={handleToggleWatchlist}
                        watchlistBusy={watchlistToggleBusy}
                        onToggleStrategyDock={() => setStrategyDockOpen((v) => !v)}
                        trendData={trendData}
                        isMobile={isMobile}
                    />
                </div>
                {isWide && (
                    <button
                        onClick={() => {
                            setOrderPanelVisible((v) => !v);
                            setTimeout(() => window.dispatchEvent(new Event('resize')), 250);
                        }}
                        className={cn(
                            "flex-shrink-0 p-1.5 mr-1 rounded-md transition-all duration-200",
                            "text-slate-400 hover:text-heading hover:bg-overlay/[0.06]",
                            !orderPanelVisible && "text-primary-500 bg-primary-500/10"
                        )}
                        title={orderPanelVisible ? "Hide order panel" : "Show order panel"}
                    >
                        {orderPanelVisible ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
                    </button>
                )}
            </div>

            {/* ── CHART AREA ────────────────────────────────────────── */}
            <div className="terminal-area-chart min-w-0 min-h-0 relative overflow-hidden">
                <ErrorBoundary fallback="Chart failed to load. Please refresh.">
                    <ZebuLiveChart
                        candles={candles}
                        isLoading={chartLoading}
                        trendData={trendData}
                        symbol={selectedSymbol}
                        period={chartPeriod}
                        onPeriodChange={setChartPeriod}
                        zeroLossTrend={zlConfidence}
                    />
                </ErrorBoundary>
            </div>

            {/* ── BOTTOM DOCK ───────────────────────────────────────── */}
            <div className={cn(
                'terminal-area-bottom min-w-0',
                bottomCollapsed ? 'h-[32px]' : 'h-[180px] lg:h-[200px]',
                'transition-all duration-200'
            )}>
                <DockContainer
                    tabs={dockTabs}
                    defaultTab="positions"
                    collapsed={bottomCollapsed}
                    onToggleCollapse={handleBottomPanelToggle}
                />
            </div>

            {/* ── ORDER PANEL AREA ──────────────────────────────────── */}
            {isWide ? (
                orderPanelVisible ? (
                    <ResizablePanel
                        side="right"
                        defaultSize={300}
                        minSize={260}
                        maxSize={420}
                        className="terminal-area-orders hidden lg:flex"
                    >
                        {orderPanelEl}
                    </ResizablePanel>
                ) : null
            ) : (
                <ResponsiveDrawer
                    open={orderDrawerOpen}
                    onClose={() => setOrderDrawerOpen(false)}
                    side="right"
                    isCompact={true}
                    width="w-[320px]"
                >
                    {orderPanelEl}
                </ResponsiveDrawer>
            )}

            {/* ── MOBILE/TABLET TRADE BAR ────────────────────────── */}
            {isCompact && (
                <div className="terminal-area-tradebar">
                    <MobileTradeBar
                        symbol={selectedSymbol}
                        price={quote?.price ?? 0}
                        onBuy={handleBuy}
                        onSell={handleSell}
                        onToggleWatchlist={() => setWatchlistDrawerOpen((v) => !v)}
                    />
                </div>
            )}

            {/* ── Floating Strategy Dock popup ───────────────────────── */}
            <ErrorBoundary fallback="Strategy dock failed to load.">
                <StrategyDock
                    candles={candles}
                    isOpen={strategyDockOpen}
                    onClose={() => setStrategyDockOpen(false)}
                />
            </ErrorBoundary>

            {/* ── Quick Order Modal (positions SELL/EXIT/BUY popup) ──── */}
            <Modal
                isOpen={quickOrderOpen}
                onClose={() => setQuickOrderOpen(false)}
                title={`${quickOrderSide === 'BUY' ? 'Buy / Exit Short' : 'Sell'} — ${quickOrderSymbol?.replace('.NS', '') || ''}`}
                size="sm"
            >
                <div className="h-[520px] overflow-y-auto">
                    <OrderPanel
                        symbol={quickOrderSymbol || selectedSymbol}
                        currentPrice={allSymbolQuotes[quickOrderSymbol]?.price ?? 0}
                        initialSide={quickOrderSide}
                        initialSideKey={quickOrderKey}
                    />
                </div>
            </Modal>
        </div>
    );
}