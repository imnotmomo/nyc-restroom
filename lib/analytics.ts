const PRODUCTION_HOSTS = new Set([
  "nyc.imfinethanku.me",
  "restroom-ready-nyc.clcii.chatgpt.site",
]);
const PAGE_PATHS = new Set([
  "/", "/conditions/", "/entry-route/", "/dated-reports/", "/find/", "/demo/", "/privacy/", "/thank-you/",
]);
const CAMPAIGN_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];

export type AnalyticsTransport = (...args: unknown[]) => void;

export function measurementId(override: string | undefined, configured: string): string | null {
  const candidate = override?.trim() || configured;
  return /^G-[A-Z0-9]+$/.test(candidate) ? candidate : null;
}

export function isAnalyticsOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.port && !url.username && !url.password
      && PRODUCTION_HOSTS.has(url.hostname);
  } catch { return false; }
}

/** Only fixed app routes and bounded campaign labels may reach the analytics provider. */
export function analyticsPageLocation(value: string): string | null {
  try {
    const url = new URL(value);
    const path = url.pathname === "/" ? "/" : `${url.pathname.replace(/\/$/, "")}/`;
    if (!isAnalyticsOrigin(value) || !PAGE_PATHS.has(path)) return null;
    const campaign = new URLSearchParams();
    for (const key of CAMPAIGN_KEYS) {
      const label = (url.searchParams.get(key) ?? "").trim().toLowerCase();
      if (label && label.length <= 120 && /^[a-z0-9 _-]+$/.test(label)) campaign.set(key, label);
    }
    return `${url.origin}${path}${campaign.size ? `?${campaign.toString()}` : ""}`;
  } catch { return null; }
}

export function analyticsReferrer(value: string, origin: string): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol)) return "";
    if (url.origin !== origin) return url.origin;
    const clean = analyticsPageLocation(`${url.origin}${url.pathname}`);
    return clean ?? url.origin;
  } catch { return ""; }
}

export function createAnalyticsClient({ id, initialUrl, referrer, transport }: {
  id: string;
  initialUrl: string;
  referrer: string;
  transport: AnalyticsTransport;
}) {
  const firstPage = analyticsPageLocation(initialUrl);
  if (!measurementId(id, "") || !firstPage) return null;
  const origin = new URL(firstPage).origin;
  let previousPage = analyticsReferrer(referrer, origin);
  let currentPage: string | null = null;
  const countedAccounts = new Set<string>();

  transport("js", new Date());
  transport("set", { page_location: firstPage, page_referrer: previousPage });
  transport("config", id, {
    send_page_view: false,
    page_location: firstPage,
    page_referrer: previousPage,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });

  function pageView(url: string, title: string): boolean {
    const page = analyticsPageLocation(url);
    if (!page || new URL(page).origin !== origin || page === currentPage) return false;
    const fields = {
      page_location: page,
      page_referrer: previousPage,
      page_title: title.slice(0, 256),
    };
    // Keep engagement events on the same sanitized location as our explicit pageview.
    transport("set", fields);
    transport("event", "page_view", { ...fields, send_to: id });
    currentPage = page;
    previousPage = page;
    return true;
  }

  // Called only with the result of a successful Firebase Google credential exchange.
  // Account IDs stay in this memory-only duplicate guard and never enter an event.
  function confirmedGoogleSignup(result: {
    isNewUser?: boolean;
    providerId?: string | null;
    accountId: string;
    currentAccountId: string | null;
  }): boolean {
    if (result.isNewUser !== true || result.providerId !== "google.com"
      || !result.accountId || result.accountId !== result.currentAccountId
      || countedAccounts.has(result.accountId)) return false;
    countedAccounts.add(result.accountId);
    transport("event", "sign_up", { method: "google", send_to: id });
    return true;
  }

  return { pageView, confirmedGoogleSignup };
}
