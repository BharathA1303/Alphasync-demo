import axios from 'axios';
import { auth, DEMO_MODE } from '../config/firebase';

const api = axios.create({
    baseURL: '/api',
    headers: { 'Content-Type': 'application/json' },
});

// Add auth token to requests
api.interceptors.request.use(async (config) => {
    try {
        if (DEMO_MODE) {
            // Demo mode — use stored demo token
            const token = localStorage.getItem('alphasync_token') || 'demo-token-alphasync';
            config.headers.Authorization = `Bearer ${token}`;
        } else {
            const currentUser = auth.currentUser;
            if (currentUser) {
                // getIdToken() auto-refreshes if token is expired
                const token = await currentUser.getIdToken();
                config.headers.Authorization = `Bearer ${token}`;
                // Also keep localStorage in sync for WebSocket connections
                localStorage.setItem('alphasync_token', token);
            }
        }
    } catch {
        // If token refresh fails, let the request proceed without auth
        // The backend will return 401 and the app will redirect to login
    }
    return config;
});

// Handle 401 responses — sign out if Firebase session is invalid
api.interceptors.response.use(
    (response) => response,
    async (error) => {
        // In demo mode, don't force logout on 401 — backend may not be running
        if (DEMO_MODE) {
            return Promise.reject(error);
        }

        if (
            error.response?.status === 401 &&
            !error.config?.url?.includes('/auth/sync') &&
            !error.config?.url?.includes('/auth/logout')
        ) {
            // Firebase token might be revoked or user deleted server-side
            const currentUser = auth.currentUser;
            if (currentUser) {
                try {
                    // Force token refresh — if Firebase rejects, sign out
                    const newToken = await currentUser.getIdToken(true);
                    error.config.headers.Authorization = `Bearer ${newToken}`;
                    return api(error.config);
                } catch {
                    // Firebase session is truly invalid
                    _forceLogout();
                }
            } else {
                _forceLogout();
            }
        }

        return Promise.reject(error);
    }
);

function _forceLogout() {
    auth.signOut?.().catch(() => { });
    localStorage.removeItem('alphasync_token');
    localStorage.removeItem('alphasync_user');
    if (window.location.pathname !== '/login') {
        window.location.href = '/login';
    }
}

export default api;
