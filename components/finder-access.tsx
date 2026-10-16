"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, LockKeyhole } from "lucide-react";

export function FinderAccessForm() {
  const [passcode, setPasscode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch("/api/finder-access", {
        method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
        referrerPolicy: "no-referrer", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode }), signal: controller.signal,
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.ok !== true) {
        setError(response.status === 401 ? "That passcode did not match. Try again."
          : response.status === 429 ? "Too many attempts. Wait a few minutes, then try again."
          : "The finder could not be unlocked. Please try again shortly.");
        return;
      }
      setPasscode("");
      window.location.assign("/find/");
    } catch {
      setError("The finder could not be unlocked. Check your connection and try again.");
    } finally {
      clearTimeout(timeout);
      setBusy(false);
    }
  }

  return <form className="finder-access-form" action="/api/finder-access" method="post" onSubmit={unlock}>
    <label htmlFor="finder-access-passcode">Access passcode</label>
    <input id="finder-access-passcode" name="passcode" type="password" autoComplete="current-password"
      maxLength={128} required value={passcode} readOnly={busy}
      onChange={(event) => { setPasscode(event.target.value); setError(null); }}
      aria-invalid={Boolean(error)} aria-describedby={error ? "finder-access-error" : undefined} />
    {error && <p id="finder-access-error" className="finder-access-error" role="alert">{error}</p>}
    <button type="submit" disabled={busy}><LockKeyhole size={18}/>{busy ? "Unlocking…" : "Open live finder"}<ArrowRight size={18}/></button>
    <noscript><p>Enable JavaScript to enter the passcode, or open the public demo.</p></noscript>
  </form>;
}
