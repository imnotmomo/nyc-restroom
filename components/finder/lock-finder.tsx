"use client";

import { useState } from "react";
import { LockKeyhole } from "lucide-react";

export function LockFinderButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function lock() {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      const response = await fetch("/api/finder-access", {
        method: "DELETE", credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer",
      });
      if (!response.ok) throw new Error("Access could not be locked");
      window.location.assign("/access/");
    } catch {
      setError(true);
      setBusy(false);
    }
  }
  return <div className="finder-lock-control"><button type="button" className="finder-account-button" disabled={busy} onClick={() => void lock()}><LockKeyhole size={16}/>{busy ? "Locking…" : "Lock finder"}</button>{error && <span role="alert">Could not lock. Please retry.</span>}</div>;
}
