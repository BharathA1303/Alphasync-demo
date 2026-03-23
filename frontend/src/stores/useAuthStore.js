import { create } from 'zustand';
import {
    auth,
    googleProvider,
    signInWithPopup,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    sendPasswordResetEmail,
    sendEmailVerification,
    updateProfile,
} from '../config/firebase';
import api from '../services/api';

async function syncUserWithBackend(firebaseUser, payload = {}) {
    const firstToken = await firebaseUser.getIdToken();
    localStorage.setItem('alphasync_token', firstToken);

    try {
        return await api.post('/auth/sync', payload);
    } catch (err) {
        if (err?.response?.status !== 401) {
            throw err;
        }

        const refreshedToken = await firebaseUser.getIdToken(true);
        localStorage.setItem('alphasync_token', refreshedToken);
        return await api.post('/auth/sync', payload);
    }
}

async function clearInvalidSession() {
    try {
        await signOut(auth);
    } catch {
    }
    localStorage.removeItem('alphasync_token');
    localStorage.removeItem('alphasync_user');
}

/**
 * Auth store — Firebase-based authentication.
 *
 * Flow:
 *   1. User signs in via Firebase (Google popup / email+password)
 *   2. Firebase returns an ID token
 *   3. ID token sent to backend POST /api/auth/sync to find-or-create local user
 *   4. Backend returns local user profile
 *   5. All subsequent API calls use the Firebase ID token as Bearer
 */
export const useAuthStore = create((set, get) => ({
    /** @type {object|null} */
    user: (() => {
        try {
            const stored = localStorage.getItem('alphasync_user');
            return stored ? JSON.parse(stored) : null;
        } catch { return null; }
    })(),

    /** @type {import('firebase/auth').User|null} */
    firebaseUser: null,

    /** @type {boolean} */
    loading: true,

    /** @type {boolean} */
    initializing: true,

    // ─── Initialize Firebase auth listener ────────────────────────────────────

    /**
     * Call once on app mount to listen for Firebase auth state changes.
     * Automatically gets fresh tokens and syncs with backend.
     */
    initAuth: () => {
        const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
            if (firebaseUser) {
                // For email/password users, don't sync until email is verified
                const isEmailProvider = firebaseUser.providerData?.[0]?.providerId === 'password';
                if (isEmailProvider && !firebaseUser.emailVerified) {
                    // Unverified email user — don't sync, sign them out
                    await signOut(auth);
                    localStorage.removeItem('alphasync_token');
                    localStorage.removeItem('alphasync_user');
                    set({ user: null, firebaseUser: null, loading: false, initializing: false });
                    return;
                }

                set({ firebaseUser, loading: true });
                try {
                    const pendingUsername = localStorage.getItem('alphasync_pending_username') || '';
                    const res = await syncUserWithBackend(
                        firebaseUser,
                        pendingUsername ? { username: pendingUsername } : {}
                    );
                    localStorage.removeItem('alphasync_pending_username');
                    localStorage.setItem('alphasync_user', JSON.stringify(res.data.user));
                    set({ user: res.data.user, loading: false, initializing: false });
                } catch (err) {
                    console.error('Auth sync failed:', err?.response?.data?.detail || err?.response?.data || err.message);
                    await clearInvalidSession();
                    set({ user: null, firebaseUser: null, loading: false, initializing: false });
                }
            } else {
                localStorage.removeItem('alphasync_token');
                localStorage.removeItem('alphasync_user');
                set({ user: null, firebaseUser: null, loading: false, initializing: false });
            }
        });
        return unsubscribe;
    },

    // ─── Actions ──────────────────────────────────────────────────────────────

    loginWithGoogle: async () => {
        const result = await signInWithPopup(auth, googleProvider);

        try {
            const res = await syncUserWithBackend(result.user, {});
            localStorage.setItem('alphasync_user', JSON.stringify(res.data.user));
            set({ user: res.data.user, firebaseUser: result.user });
            return { success: true, isNew: res.data.is_new_user };
        } catch (err) {
            const detail = err.response?.data?.detail;
            console.error('Auth sync error:', detail || err.message);
            if (err?.response?.status === 401) {
                await clearInvalidSession();
                set({ user: null, firebaseUser: null });
            }
            const error = new Error(detail || err.message);
            error.code = err.code;
            error.response = err.response;
            throw error;
        }
    },

    loginWithEmail: async (email, password) => {
        const result = await signInWithEmailAndPassword(auth, email, password);

        // Block login if email not verified
        if (!result.user.emailVerified) {
            await signOut(auth);
            const error = new Error('Please verify your email before signing in. Check your inbox.');
            error.code = 'auth/email-not-verified';
            throw error;
        }

        const pendingUsername = localStorage.getItem('alphasync_pending_username') || '';
        try {
            const res = await syncUserWithBackend(
                result.user,
                pendingUsername ? { username: pendingUsername } : {}
            );
            localStorage.removeItem('alphasync_pending_username');
            localStorage.setItem('alphasync_user', JSON.stringify(res.data.user));
            set({ user: res.data.user, firebaseUser: result.user });
            return { success: true, isNew: res.data.is_new_user };
        } catch (err) {
            if (err?.response?.status === 401) {
                await clearInvalidSession();
                set({ user: null, firebaseUser: null });
            }
            throw err;
        }
    },

    registerWithEmail: async (email, password, displayName, username) => {
        const result = await createUserWithEmailAndPassword(auth, email, password);

        // Set display name in Firebase
        if (displayName) {
            await updateProfile(result.user, { displayName });
        }

        // Send verification email — user must verify before they can trade
        await sendEmailVerification(result.user);

        // Store pending registration info so we can sync after verification
        localStorage.setItem('alphasync_pending_username', username || '');
        set({ firebaseUser: result.user });

        // Sign out immediately — user must verify email first
        await signOut(auth);
        localStorage.removeItem('alphasync_token');
        localStorage.removeItem('alphasync_user');
        set({ user: null, firebaseUser: null });

        return { success: true, needsVerification: true };
    },

    /**
     * Resend verification email to the current or provided email.
     */
    resendVerification: async (email, password) => {
        // Sign in temporarily to get the user object for resend
        const result = await signInWithEmailAndPassword(auth, email, password);
        if (!result.user.emailVerified) {
            await sendEmailVerification(result.user);
        }
        await signOut(auth);
        return { sent: !result.user.emailVerified, alreadyVerified: result.user.emailVerified };
    },

    resetPassword: async (email) => {
        await sendPasswordResetEmail(auth, email);
    },

    logout: async () => {
        try {
            await api.post('/auth/logout');
        } catch {
            // Best-effort
        }
        await signOut(auth);
        localStorage.removeItem('alphasync_token');
        localStorage.removeItem('alphasync_user');
        localStorage.removeItem('alphasync_onboarded');
        set({ user: null, firebaseUser: null });
    },

    /**
     * Get a fresh Firebase ID token (auto-refreshes if expired).
     * Used by the API interceptor.
     */
    getToken: async () => {
        const { firebaseUser } = get();
        if (!firebaseUser) {
            // Try getting from Firebase auth directly
            const currentUser = auth.currentUser;
            if (currentUser) {
                return await currentUser.getIdToken();
            }
            return null;
        }
        return await firebaseUser.getIdToken();
    },

    /**
     * Partially update user fields in store + localStorage.
     */
    updateUser: (patch) => {
        const current = get().user;
        if (!current) return;
        const updated = { ...current, ...patch };
        localStorage.setItem('alphasync_user', JSON.stringify(updated));
        set({ user: updated });
    },
}));