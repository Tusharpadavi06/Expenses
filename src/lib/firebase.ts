import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, User } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';

// In this environment, the config is provided via a JSON file after setup
const firebaseConfig = {
  apiKey: "AIzaSyCPFKiWdydwK_9kzWsRovdSwMMZrCIDtuU",
  authDomain: "expenses-e82d5.firebaseapp.com",
  projectId: "expenses-e82d5",
  storageBucket: "expenses-e82d5.firebasestorage.app",
  messagingSenderId: "998032594914",
  appId: "1:998032594914:web:4a6b7a32df2bedd5e68bbb",
  measurementId: "G-CXG5GF3V0G"
};

// Real config from provisioned Firebase project
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

export { signInWithPopup, onAuthStateChanged };
export type { User };
