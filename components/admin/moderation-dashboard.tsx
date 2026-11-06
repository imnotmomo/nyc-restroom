"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import dynamic from "next/dynamic";
import { SafetyReportQueue } from "./safety-report-queue";
import type { User } from "firebase/auth";
import {
  AlertCircle, ArrowUpRight, Check, ChevronRight, ClipboardList, Clock3, LockKeyhole,
  LogOut, MessageSquare, RefreshCw, Search, ShieldCheck, Trash2, X,
} from "lucide-react";
import { useFirebaseAccount } from "@/components/firebase-account";
import { getFirebaseClient } from "@/lib/firebase-client";
import {
  createModerationClient, DENIAL_REASONS, ModerationApiError, newModerationActionID, REMOVAL_REASONS,
  type Decision, type ModerationComment, type ModerationRequest, type ModeratorSession, type RequestStatus,
} from "@/lib/moderation-client";

// The production build explicitly sets this public compile-time flag to false.
// Keeping the dynamic import inside the branch allows its fixture chunk to be
// eliminated entirely; release checks also reject every fixture marker.
const LocalEmulatorSignIn = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true"
  ? dynamic(() => import("./moderation-emulator-signin").then(module => module.ModerationEmulatorSignIn), { ssr: false })
  : null;

type Tab = RequestStatus | "comments" | "reports";
type Access = "checking" | "allowed" | "signed-out" | "denied" | "error";
type ReviewAction = {
  target: { type: "request"; item: ModerationRequest; decision: Decision } | { type: "comment"; item: ModerationComment };
  actionId: string; reason: string; uncertain: boolean;
};
const tabLabels: Record<Tab, string> = { pending: "Pending", approved: "Approved", denied: "Denied", comments: "Comments", reports: "Reports" };
const tabCopy: Record<Tab, { title: string; description: string }> = {
  pending: { title: "Pending restrooms", description: "Review new locations before they appear on the map." },
  approved: { title: "Approved requests", description: "Published community requests and their original reporting dates." },
  denied: { title: "Denied requests", description: "Requests that were not published, with the review reason." },
  comments: { title: "Visitor comments", description: "Review public visitor text while preserving reported visit details." },
  reports: { title: "Content reports", description: "Review private reports about public text." },
};
const categoryLabels = { park: "Park", library: "Library", cafe: "Café", restaurant: "Restaurant", store: "Store", other: "Other" };
const dateTime = (value: string) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(value));
const dateOnly = (value: string | null) => value ? new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(new Date(value)) : "Not reported";
const answer = (value: string | undefined) => value === "yes" ? "Yes" : value === "no" ? "No" : "Not reported";
const commentKey = (item: Pick<ModerationComment, "kind" | "placeID" | "id">) => `${item.kind}:${item.placeID}:${item.id}`;
const isAbort = (error: unknown) => error instanceof DOMException && error.name === "AbortError";
const safeError = (error: unknown) => error instanceof ModerationApiError ? error.message : "This request could not be confirmed. Try again.";

function StatusBadge({ status }: { status: RequestStatus }) {
  return <span className={`moderation-status moderation-status-${status}`}>{status === "approved" ? <Check size={13} /> : status === "pending" ? <Clock3 size={13} /> : <X size={13} />}{tabLabels[status]}</span>;
}
function ErrorNotice({ children }: { children: React.ReactNode }) {
  return <div className="moderation-error" role="alert"><AlertCircle size={18} /><div>{children}</div></div>;
}
function EmptyQueue({ comments, filtered, more }: { comments: boolean; filtered: boolean; more: boolean }) {
  return <div className="moderation-empty">
    {comments ? <MessageSquare size={27} /> : <ClipboardList size={27} />}
    <h2>{filtered ? "No matching loaded items" : more ? "No items on this page" : comments ? "No comments to review" : "No requests here"}</h2>
    <p>{filtered ? "Try another name or clear the filter." : more ? "Load more to continue through the queue." : comments ? "Public visitor comments will appear here." : "Requests with this status will appear here."}</p>
  </div>;
}
function RequestDetails({ item, locked, openAction, headingRef }: { item: ModerationRequest; locked: boolean; openAction: (decision: Decision) => void; headingRef: RefObject<HTMLHeadingElement | null> }) {
  const listing = item.listing;
  const reason = item.reason && Object.hasOwn(DENIAL_REASONS, item.reason) ? DENIAL_REASONS[item.reason as keyof typeof DENIAL_REASONS] : null;
  return <article className="moderation-review" aria-label={`Review ${listing.name}`}>
    <div className="moderation-review-heading">
      <div className="moderation-eyebrow">Community request</div>
      <div className="moderation-title-row"><h2 ref={headingRef} tabIndex={-1}>{listing.name}</h2><StatusBadge status={item.status} /></div>
      <p className="moderation-address">{listing.address}</p>
    </div>
    <div className="moderation-review-body">
      <dl className="moderation-dates"><div><dt>Submitted</dt><dd>{dateTime(item.submittedAt)}</dd></div><div><dt>Observed</dt><dd>{dateOnly(listing.observedOn)}</dd></div></dl>
      <section className="moderation-section"><h3>Reported details</h3><dl className="moderation-facts">
        <div><dt>Category</dt><dd>{categoryLabels[listing.locationType]}</dd></div>
        <div><dt>Entry</dt><dd>{listing.entryRule === "public" ? "Public" : listing.entryRule === "customers" ? "Customers only" : "Not reported"}</dd></div>
        <div><dt>Stair-free access</dt><dd>{answer(listing.stepFreeAccess)}</dd></div>
        <div><dt>Code required</dt><dd>{answer(listing.passcodeRequired)}</dd></div>
        <div className="moderation-fact-wide"><dt>Chosen map pin</dt><dd className="moderation-coordinates">{listing.latitude.toFixed(5)}, {listing.longitude.toFixed(5)}</dd></div>
      </dl></section>
      <section className="moderation-section"><h3>Access notes</h3><p className={`moderation-original-text${listing.notes ? "" : " moderation-faint"}`}>{listing.notes || "No access notes provided."}</p></section>
      {item.hasCodeDraft && <p className="moderation-attached"><LockKeyhole size={16} /><span>An optional code is attached. Its value is not shown here.</span></p>}
      {item.reviewedAt && <div className="moderation-decision-record"><span>Reviewed {dateTime(item.reviewedAt)}</span>{reason && <strong>{reason}</strong>}</div>}
    </div>
    {item.status === "pending" ? <div className="moderation-review-actions"><p>Approval publishes these reported details.</p><div>
      <button type="button" className="moderation-button moderation-primary" disabled={locked} onClick={() => openAction("approve")}><Check size={18} />Approve restroom</button>
      <button type="button" className="moderation-button moderation-danger-outline" disabled={locked} onClick={() => openAction("deny")}><X size={18} />Deny request</button>
    </div></div> : item.status === "approved" ? <div className="moderation-review-actions"><a className="moderation-button moderation-secondary" href={`/find/?place=${encodeURIComponent(item.id)}`} target="_blank" rel="noreferrer">Open in finder<ArrowUpRight size={17} /></a></div> : null}
  </article>;
}
function CommentDetails({ item, locked, openAction, headingRef }: { item: ModerationComment; locked: boolean; openAction: () => void; headingRef: RefObject<HTMLHeadingElement | null> }) {
  return <article className="moderation-review" aria-label={`Comment at ${item.venueName}`}>
    <div className="moderation-review-heading"><div className="moderation-eyebrow">Public visitor comment</div><h2 ref={headingRef} tabIndex={-1}>{item.venueName}</h2><p className="moderation-address">{item.authorLabel} · {item.kind === "public-note" ? "Visitor note" : "Visit report"}</p></div>
    <div className="moderation-review-body">
      <dl className="moderation-dates"><div><dt>Posted</dt><dd>{dateTime(item.submittedAt)}</dd></div><div><dt>Visited</dt><dd>{dateTime(item.observedAt)}</dd></div></dl>
      <section className="moderation-section"><h3>Comment</h3><blockquote className="moderation-comment-text">{item.text}</blockquote></section>
    </div>
    <div className="moderation-review-actions"><p>Removing text preserves any structured visit details.</p><button type="button" className="moderation-button moderation-danger-outline" disabled={locked} onClick={openAction}><Trash2 size={17} />Remove comment</button></div>
  </article>;
}
function ActionDialog({ action, open, busy, error, changeReason, close, submit }: { action: ReviewAction | null; open: boolean; busy: boolean; error: string | null; changeReason: (value: string) => void; close: () => void; submit: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  const remove = action?.target.type === "comment";
  const approve = action?.target.type === "request" && action.target.decision === "approve";
  const options = remove ? REMOVAL_REASONS : DENIAL_REASONS;
  const targetName = action?.target.type === "request" ? action.target.item.listing.name : action?.target.item.venueName;
  return <dialog ref={ref} className="moderation-dialog" aria-labelledby="moderation-action-title" aria-describedby="moderation-action-description"
    onCancel={event => { event.preventDefault(); if (!busy) close(); }} onClick={event => { if (event.target === event.currentTarget && !busy) close(); }}>
    {action && <div className="moderation-dialog-inner" aria-busy={busy}>
      <div className="moderation-dialog-header"><h2 id="moderation-action-title">{approve ? "Approve this restroom?" : remove ? "Remove this comment?" : "Deny this request?"}</h2><button className="moderation-icon-button" type="button" aria-label="Close confirmation" disabled={busy} onClick={close}><X size={20} /></button></div>
      <p className="moderation-dialog-target">{targetName}</p>
      <p id="moderation-action-description" className="moderation-faint">{approve ? "These venue details will be published to the map as a community report." : remove ? "The public text will be removed. Any structured visit details will remain." : "This request will stay off the map. Choose the reason for your decision."}</p>
      {remove && action.target.type === "comment" && <blockquote className="moderation-confirm-comment">{action.target.item.text}</blockquote>}
      {!approve && <div className="moderation-reason-field"><label htmlFor="moderation-action-reason">{remove ? "Reason for removal" : "Reason for denial"}</label><select id="moderation-action-reason" value={action.reason} disabled={busy || action.uncertain} onChange={event => changeReason(event.target.value)} required><option value="">Choose a reason</option>{Object.entries(options).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>}
      {error && <ErrorNotice>{error}</ErrorNotice>}
      {action.uncertain && <p className="moderation-retry-note">Retry checks the same action. Its target and reason stay fixed until the result is confirmed.</p>}
      <div className="moderation-dialog-actions"><button type="button" className="moderation-button moderation-secondary" disabled={busy} onClick={close}>{action.uncertain ? "Return to queue" : "Cancel"}</button><button type="button" className={`moderation-button ${approve ? "moderation-primary" : "moderation-danger"}`} disabled={busy || (!approve && !action.reason)} onClick={submit}>{busy ? <><RefreshCw size={17} className="moderation-spin" />Confirming…</> : action.uncertain ? "Retry same action" : approve ? "Approve restroom" : remove ? "Remove comment" : "Deny request"}</button></div>
    </div>}
  </dialog>;
}

export function ModerationDashboard() {
  const account = useFirebaseAccount();
  const { user } = account;
  const [access, setAccess] = useState<Access>("checking");
  const [session, setSession] = useState<ModeratorSession | null>(null);
  const [authorizedUser, setAuthorizedUser] = useState<User | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [accessRefresh, setAccessRefresh] = useState(0);
  const [tab, setTab] = useState<Tab>("pending");
  const [items, setItems] = useState<ModerationRequest[]>([]);
  const [comments, setComments] = useState<ModerationComment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [moreLoading, setMoreLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [reviewWarning, setReviewWarning] = useState<string | null>(null);
  const [action, setAction] = useState<ReviewAction | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [safetyLocked, setSafetyLocked] = useState(false);
  const [safetyBusy, setSafetyBusy] = useState(false);
  const controllers = useRef(new Set<AbortController>());
  const activeOperation = useRef<object | null>(null);
  const readGeneration = useRef(0);
  const focusDetail = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const client = useMemo(() => user ? createModerationClient({
    getToken: () => user.getIdToken(), isCurrent: () => getFirebaseClient()?.auth.currentUser === user,
  }) : null, [user]);
  const clearPrivateState = useCallback(() => {
    readGeneration.current += 1;
    controllers.current.forEach(controller => controller.abort()); controllers.current.clear();
    activeOperation.current = null;
    setSafetyLocked(false); setSafetyBusy(false);
    setAuthorizedUser(null); setSession(null); setItems([]); setComments([]); setCursor(null); setSelectedKey(null); setQuery("");
    setAction(null); setDialogOpen(false); setActionError(null); setActionBusy(false); setListError(null); setNotice(null); setReviewWarning(null); setListLoading(false); setMoreLoading(false);
  }, []);
  const isCurrent = useCallback(() => Boolean(user && getFirebaseClient()?.auth.currentUser === user), [user]);
  const accessFailure = useCallback((error: unknown) => {
    if (!(error instanceof ModerationApiError) || ![401, 403].includes(error.status)) return false;
    clearPrivateState(); setAccessError(error.message); setAccess(error.status === 403 ? "denied" : "signed-out"); return true;
  }, [clearPrivateState]);

  useEffect(() => {
    let active = true;
    clearPrivateState(); setAccessError(null); setTab("pending");
    if (!user || !client) { setAccess("signed-out"); return; }
    setAccess("checking");
    const controller = new AbortController(); controllers.current.add(controller);
    void client.session(controller.signal).then(next => {
      if (!active || controller.signal.aborted || !isCurrent()) return;
      setSession(next); setListLoading(true); setAuthorizedUser(user); setAccess("allowed");
    }).catch(error => {
      if (!active || controller.signal.aborted || !isCurrent() || isAbort(error)) return;
      if (!accessFailure(error)) { setAccessError(safeError(error)); setAccess("error"); }
    }).finally(() => controllers.current.delete(controller));
    return () => { active = false; controller.abort(); controllers.current.delete(controller); };
  }, [user, client, accessRefresh, clearPrivateState, isCurrent, accessFailure]);
  useEffect(() => () => {
    readGeneration.current += 1; activeOperation.current = null;
    controllers.current.forEach(controller => controller.abort()); controllers.current.clear();
  }, []);

  useEffect(() => {
    if (!client || !authorizedUser || authorizedUser !== user || access !== "allowed" || tab === "reports") return;
    const generation = ++readGeneration.current;
    let active = true;
    const controller = new AbortController(); controllers.current.add(controller);
    setItems([]); setComments([]); setCursor(null); setSelectedKey(null); setQuery(""); setListLoading(true); setMoreLoading(false); setListError(null);
    const load = tab === "comments" ? client.comments(null, controller.signal) : client.requests(tab, null, controller.signal);
    void load.then(page => {
      if (!active || controller.signal.aborted || !isCurrent() || readGeneration.current !== generation) return;
      if (tab === "comments") setComments([...new Map((page.items as ModerationComment[]).map(item => [commentKey(item), item])).values()]);
      else setItems([...new Map((page.items as ModerationRequest[]).map(item => [item.id, item])).values()]);
      setCursor(page.nextCursor);
    }).catch(error => {
      if (!active || controller.signal.aborted || !isCurrent() || readGeneration.current !== generation || isAbort(error)) return;
      if (!accessFailure(error)) setListError(safeError(error));
    }).finally(() => { controllers.current.delete(controller); if (active && isCurrent() && readGeneration.current === generation) setListLoading(false); });
    return () => { active = false; controller.abort(); controllers.current.delete(controller); };
  }, [client, authorizedUser, user, access, tab, refresh, isCurrent, accessFailure]);

  const filteredRequests = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return items.filter(item => `${item.listing.name} ${item.listing.address}`.toLocaleLowerCase().includes(search));
  }, [items, query]);
  const filteredComments = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return comments.filter(item => `${item.venueName} ${item.text} ${item.authorLabel}`.toLocaleLowerCase().includes(search));
  }, [comments, query]);
  const selectedRequest = filteredRequests.find(item => item.id === selectedKey) ?? filteredRequests[0] ?? null;
  const selectedComment = filteredComments.find(item => commentKey(item) === selectedKey) ?? filteredComments[0] ?? null;
  const selection = tab === "comments" ? selectedComment && commentKey(selectedComment) : selectedRequest?.id;
  useEffect(() => {
    if (focusDetail.current) { headingRef.current?.focus(); focusDetail.current = false; }
  }, [selection]);

  async function loadMore() {
    if (!client || !cursor || listLoading || moreLoading || tab === "reports" || !isCurrent()) return;
    const generation = readGeneration.current;
    const controller = new AbortController(); controllers.current.add(controller);
    const activeTab = tab; setMoreLoading(true); setListError(null);
    try {
      if (activeTab === "comments") {
        const page = await client.comments(cursor, controller.signal);
        if (!controller.signal.aborted && isCurrent() && readGeneration.current === generation) { setComments(previous => [...new Map([...previous, ...page.items].map(item => [commentKey(item), item])).values()]); setCursor(page.nextCursor); }
      } else {
        const page = await client.requests(activeTab, cursor, controller.signal);
        if (!controller.signal.aborted && isCurrent() && readGeneration.current === generation) { setItems(previous => [...new Map([...previous, ...page.items].map(item => [item.id, item])).values()]); setCursor(page.nextCursor); }
      }
    } catch (error) {
      if (controller.signal.aborted || !isCurrent() || readGeneration.current !== generation || isAbort(error)) return;
      if (!accessFailure(error)) { setListError(safeError(error)); if (error instanceof ModerationApiError && error.status === 410) setCursor(null); }
    } finally { controllers.current.delete(controller); if (isCurrent() && readGeneration.current === generation) setMoreLoading(false); }
  }
  function refreshQueue() {
    readGeneration.current += 1; setReviewWarning(null); setListLoading(true); setRefresh(value => value + 1);
  }
  function changeQueue(value: Tab) {
    if (value === tab) return;
    readGeneration.current += 1;
    setItems([]); setComments([]); setCursor(null); setSelectedKey(null); setQuery(""); setListLoading(true);
    setListError(null); setNotice(null); setReviewWarning(null); setTab(value);
  }
  function openAction(target: ReviewAction["target"]) {
    if (actionBusy || action?.uncertain || safetyLocked) return;
    setAction({ target, actionId: newModerationActionID(), reason: "", uncertain: false }); setActionError(null); setDialogOpen(true);
  }
  async function submitAction() {
    if (!client || !action || activeOperation.current || !isCurrent()) return;
    const operation = {}; activeOperation.current = operation;
    const attempt = action;
    const controller = new AbortController(); controllers.current.add(controller); setActionBusy(true); setActionError(null);
    try {
      if (attempt.target.type === "request") {
        const result = await client.decide(attempt.target.item, attempt.target.decision, attempt.reason, attempt.actionId, controller.signal);
        if (controller.signal.aborted || !isCurrent()) return;
        setItems(previous => previous.filter(item => item.id !== result.id));
        setNotice(result.status === "approved" ? "Restroom approved and published to the map." : "Request denied.");
      } else {
        const result = await client.removeComment(attempt.target.item, attempt.reason, attempt.actionId, controller.signal);
        if (controller.signal.aborted || !isCurrent()) return;
        setComments(previous => previous.filter(item => commentKey(item) !== commentKey(result)));
        setNotice(result.mode === "redacted" ? "Comment removed. The reported visit details remain." : "Comment removed.");
      }
      setAction(null); setDialogOpen(false); setActionError(null); refreshQueue();
    } catch (error) {
      if (controller.signal.aborted || !isCurrent() || isAbort(error)) return;
      if (accessFailure(error)) return;
      if (error instanceof ModerationApiError && [404, 409].includes(error.status)) {
        setAction(null); setDialogOpen(false); setReviewWarning(error.message); readGeneration.current += 1; setListLoading(true); setRefresh(value => value + 1);
      } else {
        const uncertain = !(error instanceof ModerationApiError) || error.uncertain;
        setAction({ ...attempt, uncertain }); setActionError(safeError(error));
      }
    } finally {
      controllers.current.delete(controller);
      if (activeOperation.current === operation) { activeOperation.current = null; if (isCurrent()) setActionBusy(false); }
    }
  }

  const allowed = access === "allowed" && user !== null && authorizedUser === user && isCurrent();
  const locked = actionBusy || Boolean(action?.uncertain) || safetyLocked;
  const totalLoaded = tab === "comments" ? comments.length : items.length;
  const filteredCount = tab === "comments" ? filteredComments.length : filteredRequests.length;
  return <div className="moderation-shell">
    <a className="skip-link" href="#moderation-main">Skip to moderation</a>
    <header className="moderation-header">
      <a href="/" className="moderation-brand" aria-label="Restroom Ready home"><img src="/brand/mark.svg" alt="" width="34" height="34" /><span>Restroom Ready<span className="moderation-brand-label">Moderation</span></span></a>
      <div className="moderation-header-actions"><a className="moderation-open-finder" href="/find/" target="_blank" rel="noreferrer">Open finder<ArrowUpRight size={16} /></a>{user && <><span className="moderation-account-email" title={session?.user.email ?? user.email ?? ""}>{session?.user.email ?? user.email ?? "Signed in"}</span><button className="moderation-sign-out" type="button" disabled={account.loading || actionBusy || safetyBusy} onClick={() => { void account.signOut(); }}><LogOut size={17} /><span>Sign out</span></button></>}</div>
    </header>
    {LocalEmulatorSignIn && <LocalEmulatorSignIn />}
    {!allowed ? <main className="moderation-gate" id="moderation-main">
      <div className="moderation-gate-mark"><ShieldCheck size={26} /></div>
      <p className="moderation-eyebrow">Restricted workspace</p><h1>{account.loading || access === "checking" ? "Checking access…" : access === "denied" ? "Moderator access required" : access === "error" ? "Couldn’t check access" : "Moderator sign in"}</h1>
      <p className="moderation-gate-description">{access === "denied" ? "This account is not approved for moderation. Use an approved Google account to continue." : access === "error" ? "The service could not confirm your moderator access. Your review queue has not been loaded." : "Sign in with your approved Google account to review restroom requests and public comments."}</p>
      {accessError && <ErrorNotice>{accessError}</ErrorNotice>}{account.error && <ErrorNotice>{account.error}</ErrorNotice>}
      {account.loading || access === "checking" ? <p className="moderation-loading" role="status"><RefreshCw size={18} className="moderation-spin" />Checking your account</p> : <div className="moderation-gate-actions">{access === "error" ? <button type="button" className="moderation-button moderation-primary" onClick={() => setAccessRefresh(value => value + 1)}><RefreshCw size={17} />Try again</button> : <button type="button" className="moderation-button moderation-primary" disabled={!account.configured} onClick={() => { account.clearError(); void account.signInWithGoogle(); }}>{access === "denied" ? "Use another Google account" : "Sign in with Google"}</button>}<a href="/find/">Return to the public finder</a></div>}
    </main> : <div className="moderation-workspace">
      <aside className="moderation-sidebar"><div className="moderation-sidebar-label"><ShieldCheck size={15} />Moderator workspace</div><nav aria-label="Moderation queues">{(Object.keys(tabLabels) as Tab[]).map(value => <button key={value} type="button" className={tab === value ? "moderation-nav-active" : ""} aria-current={tab === value ? "page" : undefined} onClick={() => changeQueue(value)}>{value === "comments" || value === "reports" ? <MessageSquare size={19} /> : value === "approved" ? <Check size={19} /> : value === "denied" ? <X size={19} /> : <ClipboardList size={19} />}{tabLabels[value]}<ChevronRight className="moderation-nav-arrow" size={15} /></button>)}</nav><p className="moderation-sidebar-foot">Review actions are recorded. Existing city listings and imported research are kept separate.</p></aside>
      <main className="moderation-main" id="moderation-main">
        {tab !== "reports" && <>
        <div className="moderation-page-heading"><div><p className="moderation-eyebrow">Contribution review</p><h1>{tabCopy[tab].title}</h1><p>{tabCopy[tab].description}</p></div><button className="moderation-button moderation-secondary" type="button" disabled={listLoading || moreLoading || actionBusy} onClick={refreshQueue}><RefreshCw size={17} className={listLoading ? "moderation-spin" : ""} />Refresh</button></div>
        {notice && <div className="moderation-success" role="status"><Check size={18} /><span>{notice}</span><button className="moderation-icon-button" type="button" aria-label="Dismiss update" onClick={() => setNotice(null)}><X size={16} /></button></div>}
        {action?.uncertain && !dialogOpen && <div className="moderation-pending-action" role="status"><AlertCircle size={18} /><span>A review action still needs confirmation.</span><button type="button" onClick={() => setDialogOpen(true)}>Resume the same action</button></div>}
        {listError && <ErrorNotice>{listError}</ErrorNotice>}
        {reviewWarning && <ErrorNotice>{reviewWarning}</ErrorNotice>}
        <div className="moderation-toolbar"><label className="moderation-search"><Search size={18} /><span className="moderation-sr-only">Filter loaded {tab === "comments" ? "comments" : "requests"}</span><input type="search" value={query} disabled={listLoading} placeholder={tab === "comments" ? "Filter loaded comments or venues" : "Filter loaded names or addresses"} onChange={event => setQuery(event.target.value)} /></label>{!listLoading && <span className="moderation-loaded">{query.trim() ? `${filteredCount} matching · ` : ""}{totalLoaded} loaded</span>}</div>
        {listLoading ? <div className="moderation-loading-panel" role="status"><RefreshCw size={20} className="moderation-spin" />Loading {tab === "comments" ? "comments" : "requests"}…</div> : listError && !totalLoaded ? <div className="moderation-empty"><AlertCircle size={26} /><h2>Queue unavailable</h2><p>Try again to load the review queue.</p><button type="button" className="moderation-button moderation-secondary" onClick={refreshQueue}>Try again</button></div> : !filteredCount ? <EmptyQueue comments={tab === "comments"} filtered={Boolean(query.trim())} more={Boolean(cursor)} /> : <div className="moderation-queue-layout">
          <section className="moderation-queue" aria-label={tab === "comments" ? "Loaded comments" : "Loaded requests"}><ul>{tab === "comments" ? filteredComments.map(item => <li key={commentKey(item)}><button type="button" className={`moderation-queue-row${selection === commentKey(item) ? " moderation-row-selected" : ""}`} aria-pressed={selection === commentKey(item)} onClick={() => { focusDetail.current = true; setSelectedKey(commentKey(item)); }}><span className="moderation-row-top"><strong>{item.venueName}</strong><ChevronRight size={15} /></span><span className="moderation-comment-excerpt">{item.text}</span><span className="moderation-row-meta">{item.authorLabel} · {dateTime(item.submittedAt)}</span></button></li>) : filteredRequests.map(item => <li key={item.id}><button type="button" className={`moderation-queue-row${selection === item.id ? " moderation-row-selected" : ""}`} aria-pressed={selection === item.id} onClick={() => { focusDetail.current = true; setSelectedKey(item.id); }}><span className="moderation-row-top"><strong>{item.listing.name}</strong><ChevronRight size={15} /></span><span className="moderation-row-address">{item.listing.address}</span><span className="moderation-row-meta">Submitted {dateTime(item.submittedAt)}</span></button></li>)}</ul></section>
          {tab === "comments" && selectedComment ? <CommentDetails item={selectedComment} locked={locked} headingRef={headingRef} openAction={() => openAction({ type: "comment", item: selectedComment })} /> : selectedRequest ? <RequestDetails item={selectedRequest} locked={locked} headingRef={headingRef} openAction={decision => openAction({ type: "request", item: selectedRequest, decision })} /> : null}
        </div>}
        {cursor && <div className="moderation-pagination"><button className="moderation-button moderation-secondary" type="button" disabled={listLoading || moreLoading} onClick={() => { void loadMore(); }}>{moreLoading ? <><RefreshCw size={17} className="moderation-spin" />Loading…</> : "Load more"}</button><p>Filtering searches only the items loaded on this page.</p></div>}
        {safetyLocked && <div className="moderation-pending-action" role="status"><AlertCircle size={18} /><span>A content report decision still needs confirmation.</span><button type="button" onClick={() => changeQueue("reports")}>Return to reports</button></div>}
        </>}
        {user && client && <SafetyReportQueue key={user.uid} active={tab === "reports"} user={user} client={client} externallyLocked={actionBusy || Boolean(action?.uncertain)} onAccessFailure={accessFailure} onLockChange={setSafetyLocked} onBusyChange={setSafetyBusy} />}
      </main>
    </div>}
    {allowed && <ActionDialog action={action} open={dialogOpen} busy={actionBusy} error={actionError} changeReason={reason => setAction(previous => previous && !previous.uncertain ? { ...previous, reason } : previous)} close={() => { if (actionBusy) return; setDialogOpen(false); if (!action?.uncertain) { setAction(null); setActionError(null); } }} submit={() => { void submitAction(); }} />}
  </div>;
}
