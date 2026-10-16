"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Script from "next/script";
import config from "@/analytics/web-config.json";
import { analyticsPageLocation, createAnalyticsClient, measurementId } from "@/lib/analytics";

const id = measurementId(process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID, config.measurementId);
type AnalyticsWindow = Window & {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
};
let client: ReturnType<typeof createAnalyticsClient> | undefined;

function browserAnalytics() {
  if (!id || typeof window === "undefined" || !analyticsPageLocation(window.location.href)) return null;
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
  useEffect(() => {
    const analytics = browserAnalytics();
    if (!analytics) return;
    analytics.pageView(window.location.href, document.title);
    setEnabled(true);
  }, [pathname, search]);
  return enabled && id
    ? <Script src={`https://www.googletagmanager.com/gtag/js?id=${id}`} strategy="afterInteractive" />
    : null;
}

export function Analytics() {
  return <Suspense fallback={null}><PageAnalytics /></Suspense>;
}

export function SignupConfirmation() {
  useEffect(() => {
    try {
      browserAnalytics()?.confirmedSignup(window.sessionStorage, window.location.href, document.title);
    } catch { /* Analytics or storage availability never changes the saved signup. */ }
  }, []);
  return null;
}
