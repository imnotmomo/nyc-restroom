"use client";
import { FormEvent, useState } from "react";
import { ArrowUpRight, LoaderCircle } from "lucide-react";
import type { PageKey } from "@/lib/pages";

export function Signup({ source, compact = false }: { source: PageKey; compact?: boolean }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    const query = new URLSearchParams(window.location.search);
    const attribution = Object.fromEntries(["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].map(k => [k, query.get(k) ?? ""]));
    const website = new FormData(event.currentTarget).get("website");
    try {
      const response = await fetch("/api/waitlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, source, website, ...attribution }) });
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error ?? "Your email wasn’t saved. Please try again."); }
      window.location.assign("/thank-you/");
    } catch (e) { setError(e instanceof Error ? e.message : "We couldn’t connect. Please try again."); setBusy(false); }
  }
  return <form onSubmit={submit} className={`signup-form ${compact ? "compact" : ""}`}>
    <label htmlFor={`email-${compact ? "bottom" : "top"}`}>Your email</label>
    <div className="form-row"><input id={`email-${compact ? "bottom" : "top"}`} type="email" name="email" autoComplete="email" placeholder="you@example.com" maxLength={254} required value={email} onChange={e => setEmail(e.target.value)} aria-describedby={error ? `error-${compact}` : undefined} aria-invalid={!!error}/><button type="submit" disabled={busy}>{busy ? <><LoaderCircle className="spin" size={18}/> Saving</> : <>Join the waitlist <ArrowUpRight size={18}/></>}</button></div>
    <div className="honeypot" aria-hidden="true"><label htmlFor={`website-${compact}`}>Website</label><input id={`website-${compact}`} name="website" tabIndex={-1} autoComplete="off"/></div>
    {error && <p className="form-error" id={`error-${compact}`} role="alert">{error}</p>}
    <p className="form-note">An email when there’s something to try. <a href="/privacy/">How we use your email</a></p>
  </form>;
}
