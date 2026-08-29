import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { auth, googleProvider, isFirebaseEnabled } from "@/lib/firebase";

type AuthContextType = {
  user: User | null;
  loading: boolean;
  signup: (email: string, password: string, name: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isFirebaseEnabled || !auth) {
      console.log("[Auth] Firebase disabled, running in development mode");
      setLoading(false);
      return () => {};
    }

    try {
      getRedirectResult(auth).then((result) => {
        if (result?.user) console.log("[Auth] Redirect sign-in successful");
      }).catch((err) => console.warn("Redirect result error:", err));

      const unsubscribe = onAuthStateChanged(
        auth,
        (firebaseUser) => {
          setUser(firebaseUser);
          setLoading(false);
        },
        (error) => {
          console.warn("Auth state listener error:", error);
          setLoading(false);
        }
      );
      return unsubscribe;
    } catch (err) {
      console.warn("Failed to initialize auth listener:", err);
      setLoading(false);
      return () => {};
    }
  }, []);

  const signup = async (email: string, password: string, name: string) => {
    if (!isFirebaseEnabled || !auth) {
      throw new Error("Authentication requires Firebase configuration. Please add VITE_FIREBASE_* environment variables.");
    }
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(credential.user, { displayName: name });
    setUser({ ...credential.user, displayName: name });
  };

  const login = async (email: string, password: string) => {
    if (!isFirebaseEnabled || !auth) {
      throw new Error("Authentication requires Firebase configuration. Please add VITE_FIREBASE_* environment variables.");
    }
    await signInWithEmailAndPassword(auth, email, password);
  };

  const loginWithGoogle = async () => {
    if (!isFirebaseEnabled || !auth || !googleProvider) {
      throw new Error("Google sign-in requires Firebase configuration. Please add VITE_FIREBASE_* environment variables with valid credentials.");
    }
    let credential;
    try {
      credential = await signInWithPopup(auth, googleProvider);
    } catch (popupErr: any) {
      if (popupErr?.code === "auth/popup-blocked" || popupErr?.code === "auth/popup-closed-by-user") {
        await signInWithRedirect(auth, googleProvider);
        return;
      }
      throw popupErr;
    }
    const u = credential.user;
    if (!u.displayName) {
      await updateProfile(u, { displayName: u.email?.split("@")[0] ?? "User" });
    }
  };

  const logout = async () => {
    if (!isFirebaseEnabled || !auth) {
      setUser(null);
      return;
    }
    await signOut(auth);
  };

  return (
    <AuthContext.Provider value={{ user, loading, signup, login, loginWithGoogle, logout }}>
      {children}
    </AuthContext.Provider>
  );
}