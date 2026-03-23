import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../stores/useAuthStore';

/**
 * requireOnboarding — when true, user must have completed broker
 * setup before accessing the wrapped route. Otherwise they are
 * redirected to /select-mode to finish onboarding.
 */
export default function ProtectedRoute({ children, requireOnboarding = false }) {
    const user = useAuthStore((s) => s.user);
    const initializing = useAuthStore((s) => s.initializing);

    if (initializing) {
        return (
            <div className="min-h-screen bg-surface-950 flex items-center justify-center">
                <div className="w-10 h-10 border-2 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
        );
    }

    if (!user) {
        return <Navigate to="/login" replace />;
    }

    // For dashboard/app routes, ensure onboarding is complete
    if (requireOnboarding) {
        const onboarded = localStorage.getItem('alphasync_onboarded');
        if (!onboarded) {
            const tradingMode = localStorage.getItem('alphasync_trading_mode');
            if (tradingMode === 'demo') {
                // Demo mode: auto-complete onboarding and allow access
                localStorage.setItem('alphasync_onboarded', '1');
            } else if (tradingMode === 'live') {
                // Live mode: must connect broker first
                return <Navigate to="/select-broker" replace />;
            } else {
                // No mode selected yet: go to mode selection
                return <Navigate to="/select-mode" replace />;
            }
        }
    }

    return children;
}
