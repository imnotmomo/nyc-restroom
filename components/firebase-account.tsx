"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  GoogleAuthProvider,
  getAdditionalUserInfo,
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { trackNewGoogleAccount } from "@/components/analytics";
import { getFirebaseClient, getFirebaseConfigurationError } from "@/lib/firebase-client";

export interface FirebaseAccountContextValue {
  user: User | null;
  loading: boolean;
  configured: boolean;
  error: string | null;
  signInWithGoogle: () => Promise<boolean>;
  signOut: () => Promise<boolean>;
  clearError: () => void;
}

const FirebaseAccountContext = createContext<FirebaseAccountContextValue | null>(null);

function accountError(error: unknown): string {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String(error.code) : "";
  switch (code) {
    case "auth/popup-blocked":
      return "Your browser blocked the Google sign-in window. Allow popups for this site, then choose Sign in again.";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "Google sign-in was cancelled. You can try again or keep browsing without an account.";
    case "auth/operation-not-allowed":
    case "auth/configuration-not-found":
      return "Google sign-in hasn’t been enabled for this Firebase project. The project owner needs to enable the Google provider.";
    case "auth/unauthorized-domain":
    case "auth/app-not-authorized":
      return "This website’s domain isn’t authorized for Google sign-in yet. The project owner needs to add this hostname to Firebase Authentication’s authorized domains.";
    case "auth/invalid-api-key":
    case "auth/invalid-app-credential":
      return "The Firebase web configuration needs to be checked before account sign-in can work. You can still browse.";
    case "auth/network-request-failed":
      return "Google sign-in couldn’t connect. Check your connection and try again.";
    case "auth/web-storage-unsupported":
    case "auth/unsupported-persistence-type":
      return "Account sign-in needs browser storage. Allow site storage or try a regular browser window.";
    case "auth/account-exists-with-different-credential":
      return "An account already exists with a different sign-in method. Use its original provider; this app currently supports Google sign-in.";
    case "auth/user-disabled":
      return "This account has been disabled. Contact the project owner before trying again.";
    case "auth/too-many-requests":
      return "There have been too many sign-in attempts. Wait a moment, then try again.";
    default:
      return "Account access couldn’t finish. Please try again. Browsing is still available.";
  }
}

export function FirebaseAccountProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    try {
      const client = getFirebaseClient();
      if (!client) {
        setError(getFirebaseConfigurationError());
        setLoading(false);
        return;
      }
      setConfigured(true);
      return onAuthStateChanged(client.auth, (nextUser) => {
        setUser(nextUser);
        setLoading(false);
      }, (nextError) => {
        setUser(null);
        setError(accountError(nextError));
        setLoading(false);
      });
    } catch (nextError) {
      setError(accountError(nextError));
      setLoading(false);
    }
  }, []);

  const signInWithGoogle = useCallback(async () => {
    if (busy.current) return false;
    busy.current = true;
    setError(null);
    try {
      const client = getFirebaseClient();
      if (!client) {
        setError(getFirebaseConfigurationError() ?? "Google sign-in isn’t configured yet.");
        return false;
      }
      setLoading(true);
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      // Keep the popup directly within the click action so browsers can open it.
      const result = await signInWithPopup(client.auth, provider);
      setUser(result.user);
      try {
        const info = getAdditionalUserInfo(result);
        trackNewGoogleAccount({
          isNewUser: info?.isNewUser,
          providerId: info?.providerId,
          accountId: result.user.uid,
          currentAccountId: client.auth.currentUser?.uid ?? null,
        });
      } catch { /* Metadata or Analytics failures cannot turn a completed sign-in into failure. */ }
      return true;
    } catch (nextError) {
      setError(accountError(nextError));
      return false;
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    if (busy.current) return false;
    busy.current = true;
    setError(null);
    try {
      const client = getFirebaseClient();
      if (!client) {
        setError(getFirebaseConfigurationError() ?? "Account sign-out isn’t available in this build.");
        return false;
      }
      setLoading(true);
      await firebaseSignOut(client.auth);
      setUser(null);
      return true;
    } catch (nextError) {
      setError(accountError(nextError));
      return false;
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);
  return <FirebaseAccountContext.Provider value={{ user, loading, configured, error, signInWithGoogle, signOut, clearError }}>
    {children}
  </FirebaseAccountContext.Provider>;
}

export function useFirebaseAccount(): FirebaseAccountContextValue {
  const account = useContext(FirebaseAccountContext);
  if (!account) throw new Error("useFirebaseAccount must be used inside FirebaseAccountProvider.");
  return account;
}

export function FirebaseAccountButton({ className }: { className?: string }) {
  const { user, loading, configured, signInWithGoogle, signOut } = useFirebaseAccount();
  return <button className={className} type="button" disabled={loading || !configured}
    onClick={() => { void (user ? signOut() : signInWithGoogle()); }}>
    {loading ? "Connecting account…" : user ? "Sign out" : "Sign in with Google"}
  </button>;
}
