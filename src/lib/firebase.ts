import { initializeApp, getApps } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string,
};

// Check if all required config values are present
const hasValidConfig = firebaseConfig.apiKey &&
  firebaseConfig.authDomain &&
  firebaseConfig.projectId &&
  firebaseConfig.storageBucket &&
  firebaseConfig.messagingSenderId &&
  firebaseConfig.appId &&
  !firebaseConfig.apiKey.includes("dev-") &&
  !firebaseConfig.apiKey.includes("your-");

let app;
let auth;
let googleProvider;

if (hasValidConfig && getApps().length === 0) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  googleProvider = new GoogleAuthProvider();
  console.log("[Firebase] Initialized with valid config");
} else if (hasValidConfig && getApps().length > 0) {
  app = getApps()[0];
  auth = getAuth(app);
  googleProvider = new GoogleAuthProvider();
  console.log("[Firebase] Using existing app instance");
} else {
  // Development mode without Firebase - create mock auth
  console.warn("[Firebase] No valid config found. Running in development mode without authentication.");
  auth = null;
  googleProvider = null;
}

export { auth, googleProvider };
export const isFirebaseEnabled = hasValidConfig;