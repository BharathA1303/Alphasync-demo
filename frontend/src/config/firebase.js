/**
 * Firebase client configuration for AlphaSync.
 *
 * When VITE_FIREBASE_* env vars are set → uses real Firebase authentication.
 * When credentials are missing → runs in DEMO MODE with a mock auth layer
 * so the app works out of the box without any Firebase setup.
 */
import { initializeApp } from 'firebase/app';
import {
    getAuth,
    GoogleAuthProvider,
    signInWithPopup as fbSignInWithPopup,
    signInWithEmailAndPassword as fbSignInWithEmail,
    createUserWithEmailAndPassword as fbCreateUser,
    signOut as fbSignOut,
    onAuthStateChanged as fbOnAuthStateChanged,
    sendPasswordResetEmail as fbSendPasswordReset,
    sendEmailVerification as fbSendEmailVerification,
    updateProfile as fbUpdateProfile,
} from 'firebase/auth';

// ── Check for valid Firebase credentials ──────────────────────────────────────

const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
    appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
};

const hasValidConfig = Object.values(firebaseConfig).every(
    (v) => typeof v === 'string' && v.length > 0 && !v.includes('YOUR_')
);

export const DEMO_MODE = !hasValidConfig;

// ══════════════════════════════════════════════════════════════════════════════
// Real Firebase (when credentials are configured)
// ══════════════════════════════════════════════════════════════════════════════

let app = null;
let auth = null;
let googleProvider = null;

if (hasValidConfig) {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    googleProvider = new GoogleAuthProvider();
}

// ══════════════════════════════════════════════════════════════════════════════
// Demo mode mock auth (when no Firebase credentials)
// ══════════════════════════════════════════════════════════════════════════════

const DEMO_USER = {
    uid: 'demo-user-001',
    email: 'demo@alphasync.app',
    displayName: 'Demo Trader',
    emailVerified: true,
    photoURL: null,
    providerData: [{ providerId: 'demo' }],
    getIdToken: async () => 'demo-token-alphasync',
};

let _demoCbs = [];
let _demoCurrent = null;

const demoAuth = {
    get currentUser() { return _demoCurrent; },
    _setUser(u) { _demoCurrent = u; _demoCbs.forEach((cb) => cb(u)); },
};

if (!hasValidConfig) {
    console.info(
        '%c[AlphaSync] Running in DEMO MODE — Firebase not configured.',
        'color: #0EA5E9; font-weight: bold'
    );
    auth = demoAuth;
    googleProvider = {};
    app = {};
}

// ── Unified function exports ──────────────────────────────────────────────────

const demoSignIn = async () => { demoAuth._setUser(DEMO_USER); return { user: DEMO_USER }; };
const noop = async () => {};

const signInWithPopup              = hasValidConfig ? fbSignInWithPopup              : demoSignIn;
const signInWithEmailAndPassword   = hasValidConfig ? fbSignInWithEmail              : demoSignIn;
const createUserWithEmailAndPassword = hasValidConfig ? fbCreateUser                 : demoSignIn;
const signOut                      = hasValidConfig ? fbSignOut                      : async () => demoAuth._setUser(null);
const sendPasswordResetEmail       = hasValidConfig ? fbSendPasswordReset            : noop;
const sendEmailVerification        = hasValidConfig ? fbSendEmailVerification        : noop;
const updateProfile                = hasValidConfig ? fbUpdateProfile                : noop;

const onAuthStateChanged = hasValidConfig
    ? fbOnAuthStateChanged
    : (_a, cb) => {
        _demoCbs.push(cb);
        setTimeout(() => cb(_demoCurrent), 0);
        return () => { _demoCbs = _demoCbs.filter((c) => c !== cb); };
    };

export {
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
};
export default app;
