/**
 * Firebase client configuration for AlphaSync.
 *
 * Replace the placeholder values below with your actual Firebase project config
 * from: Firebase Console → Project Settings → General → Your Apps → Config.
 *
 * For production, use environment variables via Vite:
 *   VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, etc.
 */
import { initializeApp } from 'firebase/app';
import {
    getAuth,
    GoogleAuthProvider,
    signInWithPopup,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    sendPasswordResetEmail,
    sendEmailVerification,
    updateProfile,
} from 'firebase/auth';

const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'YOUR_API_KEY',
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'YOUR_PROJECT.firebaseapp.com',
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'YOUR_PROJECT_ID',
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'YOUR_PROJECT.appspot.com',
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || 'YOUR_SENDER_ID',
    appId: import.meta.env.VITE_FIREBASE_APP_ID || 'YOUR_APP_ID',
};

const missingFirebaseWebConfig = Object.entries(firebaseConfig)
    .filter(([, value]) => typeof value !== 'string' || !value || value.includes('YOUR_'))
    .map(([key]) => key);

if (missingFirebaseWebConfig.length > 0) {
    throw new Error(
        `Missing Firebase web config: ${missingFirebaseWebConfig.join(', ')}. ` +
        'Set VITE_FIREBASE_* values in frontend/.env.local (Firebase Console → Project Settings → General → Your Apps → Web app config).'
    );
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

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
