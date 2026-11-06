"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Script from "next/script";
import config from "@/analytics/web-config.json";
import { analyticsPageLocation, createAnalyticsClient, createPendingGoogleSignupDelivery, measurementId, type ConfirmedGoogleAccount } from "@/lib/analytics";

const id = measurementId(process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID, config.measurementId);
type AnalyticsWindow = Window & {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
};
let client: ReturnType<typeof createAnalyticsClient> | undefined;
const signupDelivery = createPendingGoogleSignupDelivery({
  deliver: (result) => browserAnalytics()?.confirmedGoogleSignup(result) ?? false,
});

function browserAnalytics() {
  if (!id || typeof window === "undefined") return null;
  const allowed = Boolean(analyticsPageLocation(window.location.href));
  // A script loaded on a prior public route must also stop collecting when
  // client navigation enters moderation or another non-public route.
  Reflect.set(window, `ga-disable-${id}`, !allowed);
  if (!allowed) { signupDelivery.clear(); return null; }
  if (client) return client;
  const browser = window as AnalyticsWindow;
  browser.dataLayer ??= [];
  browser.gtag ??= function () { browser.dataLayer!.push(arguments); };
  client = createAnalyticsClient({
    id,
    initialUrl: window.location.href,
    referrer: document.referrer,
    transport: (...args) => browser.gtag!(...args),
  });
  return client;
}

function PageAnalytics() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [enabled, setEnabled] = useState(false);
  const [tagReady, setTagReady] = useState(false);
  useEffect(() => {
    const retry = () => {
      const eligible = Boolean(id && analyticsPageLocation(window.location.href));
      // Loading the tag must not depend on a prior successful queue/config call.
      // Otherwise a recovered signup could sit forever in an undrained queue.
      setEnabled(eligible);
      if (!eligible) {
        browserAnalytics(); setEnabled(false); return;
      }
      if (document.visibilityState !== "visible") return;
      try {
        const analytics = browserAnalytics();
        if (!analytics) return;
        analytics.pageView(window.location.href, document.title);
        signupDelivery.retry();
      } catch { /* Account access remains usable; retry on tag readiness/foreground. */ }
    };
    retry();
    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", retry);
    return () => {
      window.removeEventListener("online", retry);
      document.removeEventListener("visibilitychange", retry);
    };
  }, [pathname, search, tagReady]);
  return enabled && id
    ? <Script src={`https://www.googletagmanager.com/gtag/js?id=${id}`} strategy="afterInteractive"
      onReady={() => { setTagReady(true); signupDelivery.retry(); }} />
    : null;
}

export function Analytics() {
  return <Suspense fallback={null}><PageAnalytics /></Suspense>;
}

export function setAnalyticsAccount(accountId: string | null, allowed = true) {
  const eligible = allowed && typeof window !== "undefined" && Boolean(analyticsPageLocation(window.location.href));
  signupDelivery.setAccount(accountId, eligible);
}

export function trackNewGoogleAccount(result: ConfirmedGoogleAccount) {
  try {
    if (typeof window === "undefined" || !analyticsPageLocation(window.location.href)) {
      signupDelivery.clear(); return;
    }
    signupDelivery.setAccount(result.currentAccountId);
    signupDelivery.confirm(result);
  }
  catch { /* Analytics must never fail an otherwise successful sign-in. */ }
}
