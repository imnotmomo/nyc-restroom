"use client";

import { useEffect, useState } from "react";
import { GoogleAuthProvider, signInWithCredential } from "firebase/auth";
import { getFirebaseClient, type FirebaseClient } from "@/lib/firebase-client";

/** Actual Firebase SDK sign-in for isolated UI QA; never a production login. */
function localEmulatorClient(): FirebaseClient | null {
  if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS !== "true" || typeof window === "undefined"
    || !["localhost", "127.0.0.1"].includes(window.location.hostname)) return null;
  const client = getFirebaseClient();
  const emulator = client?.auth.emulatorConfig;
  if (!client || client.app.options.projectId !== "demo-moderation-ui"
    || !client.app.options.apiKey?.startsWith("demo-")
    || !emulator || !["localhost", "127.0.0.1"].includes(emulator.host)
    || emulator.port !== 9099 || emulator.protocol !== "http") return null;
  return client;
}

export function ModerationEmulatorSignIn() {
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    try { setAvailable(localEmulatorClient() !== null); }
    catch { setAvailable(false); }
  }, []);

  async function signIn(kind: "moderator" | "visitor") {
    if (busy) return;
    setBusy(true); setMessage(null); setError(null);
    try {
      const client = localEmulatorClient();
      if (!client) throw new Error("Unavailable local emulator");
      // The Auth emulator accepts this explicit local Google-provider fixture.
      // It is not a real Google token and cannot authenticate to production.
      const fixture = kind === "moderator"
        ? { sub: "qa-moderator-browser", email: "moderator@example.test", email_verified: true, name: "Local moderator fixture" }
        : { sub: "qa-visitor-browser", email: "visitor@example.test", email_verified: true, name: "Local visitor fixture" };
      const result = await signInWithCredential(client.auth, GoogleAuthProvider.credential(JSON.stringify(fixture)));
      if (localEmulatorClient() !== client || client.auth.currentUser !== result.user) throw new Error("Local account changed");
      setMessage(kind === "moderator" ? "Local moderator fixture signed in." : "Local visitor fixture signed in.");
    } catch {
      setError("Local emulator sign-in could not finish. Check the demo configuration and Auth emulator.");
    } finally { setBusy(false); }
  }

  if (!available) return null;
  return <aside aria-label="Local emulator QA" style={{ margin: "16px 24px", padding: "14px 16px", border: "1px dashed #80939d", background: "#fff9eb", borderRadius: 3 }}>
    <strong style={{ fontSize: 13 }}>Local Auth emulator only</strong>
    <p style={{ fontSize: 12, marginTop: 4 }}>Demo identities for local browser checks. Moderator access still comes from the API.</p>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 12 }}>
      <button type="button" className="moderation-button moderation-secondary" disabled={busy} onClick={() => { void signIn("moderator"); }}>Sign in as local moderator</button>
      <button type="button" className="moderation-button moderation-secondary" disabled={busy} onClick={() => { void signIn("visitor"); }}>Sign in as local visitor</button>
    </div>
    {busy && <p role="status" style={{ fontSize: 12, marginTop: 10 }}>Signing in to the local emulator…</p>}
    {message && <p role="status" style={{ fontSize: 12, marginTop: 10 }}>{message}</p>}
    {error && <p role="alert" style={{ fontSize: 12, marginTop: 10, color: "#b8352b" }}>{error}</p>}
  </aside>;
}
