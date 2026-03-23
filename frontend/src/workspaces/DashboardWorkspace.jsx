// ─── DashboardWorkspace ──────────────────────────────────────────────────────
// Clean overview hub — KPI cards + navigation grid to each section.
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../stores/useAuthStore';
import { usePortfolioStore } from '../store/usePortfolioStore';
import {
    TrendingUp, TrendingDown, IndianRupee,
    BarChart3, ArrowRight, Zap, Briefcase,
    ShieldCheck, ClipboardList, Globe, Landmark,
} from 'lucide-react';
import { formatCurrency, pnlColorClass } from '../utils/formatters';
import { Skeleton } from '../components/ui';
import { cn } from '../utils/cn';

const NAV_CARDS = [
    { to: '/terminal', icon: BarChart3, label: 'Terminal', desc: 'Live charts & order execution', accent: true },
    { to: '/market', icon: Globe, label: 'Market', desc: 'Indices & market overview' },
    { to: '/futures', icon: Landmark, label: 'Futures', desc: 'Dummy futures strikes by stock' },
    { to: '/portfolio', icon: Briefcase, label: 'Portfolio', desc: 'Holdings & performance' },
    { to: '/orders', icon: ClipboardList, label: 'Orders', desc: 'Order history & status' },
    { to: '/algo', icon: Zap, label: 'Algo Trading', desc: 'Automated strategies' },
    { to: '/zeroloss', icon: ShieldCheck, label: 'ZeroLoss', desc: 'Confidence-gated strategy' },
];

export default function DashboardWorkspace() {
    const user = useAuthStore((s) => s.user);
    const portfolio = usePortfolioStore((s) => s.summary);
    const loading = usePortfolioStore((s) => s.isLoading);
    const refreshPortfolio = usePortfolioStore((s) => s.refreshPortfolio);

    useEffect(() => {
        refreshPortfolio();
    }, [refreshPortfolio]);

    if (loading) {
        return (
            <div className="p-4 lg:p-6 space-y-6">
                <Skeleton variant="text" className="h-8 w-48" />
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                    <Skeleton variant="stat-card" count={5} />
                </div>
            </div>
        );
    }

    const totalCapital = Number(portfolio?.available_capital || 0) + Number(portfolio?.current_value || 0);
    const totalPnl = portfolio?.total_pnl || 0;

    const STAT_CARDS = [
        { label: 'Total Capital', value: formatCurrency(totalCapital), icon: IndianRupee },
        { label: 'Available Cash', value: formatCurrency(portfolio?.available_capital), icon: IndianRupee },
        { label: 'Invested', value: formatCurrency(portfolio?.total_invested), icon: BarChart3 },
        { label: 'Current Value', value: formatCurrency(portfolio?.current_value), icon: TrendingUp },
        { label: 'Total P&L', value: formatCurrency(totalPnl), pnl: totalPnl, icon: totalPnl >= 0 ? TrendingUp : TrendingDown },
    ];

    return (
        <div className="p-4 lg:p-6 space-y-6 animate-fade-in">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-display font-semibold text-heading">
                    Welcome, {user?.full_name?.split(' ')[0] || user?.username || 'Trader'}
                </h1>
                <p className="text-slate-600 dark:text-slate-400 text-sm mt-0.5">Your trading overview</p>
            </div>

            {/* Stat Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                {STAT_CARDS.map(({ label, value, icon: Icon, pnl }) => (
                    <div key={label} className="stat-card">
                        <div className="flex items-center justify-between mb-1">
                            <span className="text-xs text-slate-600 dark:text-slate-400 uppercase tracking-wider font-medium">{label}</span>
                            <Icon className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                        </div>
                        <span className={cn('text-xl font-semibold font-mono', pnl !== undefined ? pnlColorClass(pnl) : 'text-heading')}>
                            {value}
                        </span>
                    </div>
                ))}
            </div>

            {/* Navigation Grid */}
            <div>
                <h2 className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-3">Navigate</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {NAV_CARDS.map(({ to, icon: Icon, label, desc, accent }) => (
                        <Link
                            key={to}
                            to={to}
                            className={cn(
                                'glass-card-hover p-5 flex items-start gap-4 group border transition-all duration-200',
                                accent 
                                  ? 'border-blue-200 dark:border-primary-500/15 bg-blue-50 dark:bg-primary-600/[0.04]'
                                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50'
                            )}
                        >
                            <div className={cn(
                                'p-2.5 rounded-lg flex-shrink-0',
                                accent ? 'bg-blue-100 dark:bg-primary-500/10' : 'bg-slate-100 dark:bg-surface-800/60'
                            )}>
                                <Icon className={cn('w-5 h-5', accent ? 'text-blue-600 dark:text-blue-400' : 'text-slate-600 dark:text-slate-400')} />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className={cn('text-sm font-semibold', accent ? 'text-blue-600 dark:text-blue-400' : 'text-slate-700 dark:text-slate-300')}>
                                        {label}
                                    </span>
                                    <ArrowRight className={cn('w-3.5 h-3.5 group-hover:translate-x-0.5 transition-all', accent ? 'text-blue-600 dark:text-blue-400 group-hover:text-blue-600 dark:group-hover:text-blue-400' : 'text-slate-600 dark:text-slate-400 group-hover:text-slate-700 dark:group-hover:text-slate-300')} />
                                </div>
                                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">{desc}</p>
                            </div>
                        </Link>
                    ))}
                </div>
            </div>
        </div>
    );
}
