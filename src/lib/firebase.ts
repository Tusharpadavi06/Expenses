import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, User } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

// Support dynamic client-side environment variable overrides (e.g., for Vercel deployments)
const metaEnv = (import.meta as any).env || {};
const config = {
  apiKey: metaEnv.VITE_FIREBASE_API_KEY || firebaseConfig.apiKey,
  authDomain: metaEnv.VITE_FIREBASE_AUTH_DOMAIN || firebaseConfig.authDomain,
  projectId: metaEnv.VITE_FIREBASE_PROJECT_ID || firebaseConfig.projectId,
  storageBucket: metaEnv.VITE_FIREBASE_STORAGE_BUCKET || firebaseConfig.storageBucket,
  messagingSenderId: metaEnv.VITE_FIREBASE_MESSAGING_SENDER_ID || firebaseConfig.messagingSenderId,
  appId: metaEnv.VITE_FIREBASE_APP_ID || firebaseConfig.appId,
  firestoreDatabaseId: metaEnv.VITE_FIREBASE_DATABASE_ID || (firebaseConfig as any).firestoreDatabaseId
};

// Initialize and export services with determined configuration
const app = initializeApp(config);
export const auth = getAuth(app);
export const db = (config.firestoreDatabaseId && config.firestoreDatabaseId !== '(default)') ? getFirestore(app, config.firestoreDatabaseId) : getFirestore(app); // Use correct database ID
export const googleProvider = new GoogleAuthProvider();

export { signInWithPopup, onAuthStateChanged };
export type { User };

