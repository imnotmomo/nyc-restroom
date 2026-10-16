import { getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import registeredWebConfig from "@/firebase/web-config.json";

const options: FirebaseOptions = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || registeredWebConfig.apiKey,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || registeredWebConfig.authDomain,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || registeredWebConfig.projectId,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || registeredWebConfig.storageBucket,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || registeredWebConfig.messagingSenderId,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || registeredWebConfig.appId,
};

export interface FirebaseClient {
  app: FirebaseApp;
  auth: Auth;
}

let client: FirebaseClient | undefined;

export function getFirebaseConfigurationError(): string | null {
  if (!options.apiKey || !options.authDomain || !options.projectId || !options.appId) {
    return "Account sign-in isn’t connected in this build. The team needs to add its Firebase web configuration and rebuild. You can still browse the NYC listings.";
  }
  if (options.authDomain.includes("://") || options.authDomain.includes("/")) {
    return "The Firebase authentication domain needs to be a hostname without a protocol or path. The team needs to correct the web configuration and rebuild.";
  }
  return null;
}

/** Initialize only in a browser; importing this module during static export is safe. */
export function getFirebaseClient(): FirebaseClient | null {
  if (typeof window === "undefined" || getFirebaseConfigurationError()) return null;
  if (client) return client;
  const existing = getApps().find((app) => app.name === "[DEFAULT]");
  if (existing && (existing.options.projectId !== options.projectId || existing.options.appId !== options.appId)) {
    throw new Error("A different Firebase project is already connected. Reload after checking the app configuration.");
  }
  const app = existing ?? initializeApp(options);
  client = { app, auth: getAuth(app) };
  return client;
}
