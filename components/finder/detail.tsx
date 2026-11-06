"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowUpRight, Bookmark, Building2, Clock, DoorOpen, Footprints, Info, MapPin, MessageSquareText, X } from "lucide-react";
import { datasetSource, fact, formatDistance, sourceDateLabel, walkingDirections, type Coordinates, type Restroom } from "@/lib/restrooms";
import { accessibilityStatus, ACCESSIBILITY_VALUES } from "@/lib/accessibility";
import { SourceReports } from "@/components/finder/source-reports";
import { SourceComments } from "@/components/finder/source-comments";
import { accessDetailsDate, accessDetailsProvenance, elevatorToRestroomStatus, stairFreeRouteStatus } from "@/lib/restroom-access-details-model";
import { coveredCardResearchCommentIDs, emptyCardResearchFeed, selectedCardResearchFeed, watchCardResearch, type CardResearchFeed } from "@/lib/card-research";
import { factsForSection, type CardResearchFact } from "@/lib/card-research-model";
import { knownCardHours, showOriginalCardFact } from "@/lib/card-research-view";
import { CardResearchComments, CardResearchRows } from "@/components/finder/card-research";
import { cardHoursPresentation } from "@/lib/hours-schedule";
import { useHoursDate } from "@/components/finder/use-hours-date";

function FactRow({ label, value, unknown = false }: { label: string; value: string; unknown?: boolean }) {
  return <div className={`finder-fact${unknown ? " is-unknown" : ""}`}><dt>{label}</dt><dd>{value}</dd></div>;
}

function submissionDate(value: string): string {
  return new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

const entryLabels = { public: "Public entry reported", customers: "Customers only reported", unknown: "Not reported" };
const routeLabels = { yes: "Yes — reported", no: "No — reported", unknown: "Not reported" };
const codeRequiredLabels = { yes: "Yes — reported", no: "No — reported", unknown: "Not reported" };

export interface RestroomDetailProps {
  restroom: Restroom;
  distance: number | null;
  userLocation: Coordinates | null;
  saved: boolean;
  saving: boolean;
  onToggleFavorite: () => void;
  onClose: () => void;
  visitReportContent?: ReactNode;
  passcodeContent?: ReactNode;
  ratingContent: ReactNode;
  personalContent: ReactNode;
  feedback: string | null;
  onRetryLibrary?: () => void;
}

export function RestroomDetail(props: RestroomDetailProps) {
  const placeID = props.restroom.id;
  const [retry, setRetry] = useState(0);
  const [feed, setFeed] = useState<CardResearchFeed>(() => emptyCardResearchFeed(placeID));
  useEffect(() => {
    let active = true;
    setFeed(previous => ({ ...selectedCardResearchFeed(previous, placeID), loading: true, error: null }));
    const unsubscribe = watchCardResearch(placeID, profile => {
      if (active) setFeed({ placeID, profile, loading: false, error: null });
    }, error => {
      if (active) setFeed(previous => ({ ...selectedCardResearchFeed(previous, placeID), loading: false, error: error.message }));
    });
    return () => { active = false; unsubscribe(); };
  }, [placeID, retry]);
  return <RestroomDetailView {...props} research={selectedCardResearchFeed(feed, placeID)} onRetryResearch={() => setRetry(value => value + 1)} />;
}

/** Presentation receives only the current selected-place feed; writes remain in existing contribution components. */
export function RestroomDetailView({ restroom, distance, userLocation, saved, saving, onToggleFavorite, onClose, visitReportContent, passcodeContent, ratingContent, personalContent, feedback, onRetryLibrary, research, onRetryResearch, hoursDate }: RestroomDetailProps & {
  research: CardResearchFeed; onRetryResearch: () => void; hoursDate?: Date;
}) {
  const liveHoursDate = useHoursDate();
  const community = restroom.communitySource;
  const accessibility = accessibilityStatus(restroom);
  const access = restroom.accessDetails;
  const reportedHours = knownCardHours(access?.restroomHours);
  const hours = reportedHours ?? knownCardHours(restroom.hours);
  const floor = access?.restroomFloor ?? restroom.restroomFloor;
  const stairFree = stairFreeRouteStatus(restroom);
  const elevator = elevatorToRestroomStatus(restroom);
  const current = selectedCardResearchFeed(research, restroom.id);
  const profile = current.profile;
  const inSection = (section: Parameters<typeof factsForSection>[1]) => profile ? factsForSection(profile, section) : [];
  const hourFacts = inSection("hours").filter(row => !["hours", "restroomHours", "venueHours"].includes(row.field) || knownCardHours(row.value) !== null);
  const hoursSummary = cardHoursPresentation({ reported: reportedHours, listed: restroom.hours, facts: hourFacts }, hoursDate ?? liveHoursDate);
  const restroomHourFacts = hourFacts.filter(row => ["hours", "restroomHours"].includes(row.field) && ["restroom", "route"].includes(row.scope));
  const showListedHours = hours === null ? restroomHourFacts.length === 0 : !restroomHourFacts.some(row => knownCardHours(row.value) === hours);
  const entryFacts = inSection("entryRoute").filter(row => ["entryRule", "purchaseRequired", "accessRestriction", "accessNotes", "identity"].includes(row.field));
  const routeFacts = inSection("entryRoute").filter(row => !entryFacts.includes(row));
  const showOriginal = (fields: readonly string[], value: string | null | undefined, unknown: boolean, scopes?: readonly string[]) =>
    showOriginalCardFact(profile, fields, value, unknown, scopes);
  const rows = (section: Parameters<typeof factsForSection>[1], facts?: readonly CardResearchFact[]) => profile
    ? <CardResearchRows profile={profile} section={section} facts={facts} /> : null;
  const coveredIDs = coveredCardResearchCommentIDs(current, restroom.id);
  return <aside className="finder-detail" aria-labelledby="finder-detail-title" id="restroom-details" tabIndex={-1}>
    <header className="finder-detail-heading">
      <button type="button" className="finder-icon-button finder-close" onClick={onClose} aria-label="Close location details"><ArrowLeft size={18} className="finder-close-back-icon" /><span className="finder-close-text">Back to results</span><X size={20} className="finder-close-x-icon" /></button>
      <span className="finder-overline">Location details</span>
      <h2 id="finder-detail-title">{restroom.name}</h2>
      <p><MapPin size={15} />{restroom.locationType ?? "City-listed location"}{distance !== null && <> <span>·</span> {formatDistance(distance)} straight-line from your location</>}</p>
      <div className="finder-detail-actions">
        <a className="finder-primary-button" href={walkingDirections(restroom, userLocation ?? undefined)} target="_blank" rel="noreferrer">Walking directions <ArrowUpRight size={18} /></a>
        <button className={`finder-save-button${saved ? " is-saved" : ""}`} type="button" onClick={onToggleFavorite} disabled={saving} aria-pressed={saved} aria-label={saved ? "Remove saved restroom" : "Save restroom"}><Bookmark size={20} fill={saved ? "currentColor" : "none"} />{saving ? "Saving…" : saved ? "Saved" : "Save"}</button>
      </div>
      <p className="finder-directions-note">Directions open Google Maps. Check venue rules before going.</p>
      {feedback && <p className="finder-detail-feedback" role="alert">{feedback}</p>}
      {onRetryLibrary && <button className="finder-secondary-button" type="button" onClick={onRetryLibrary}>Retry loading saved places</button>}
    </header>

    {current.loading && <p className="finder-research-status" role="status">Loading additional listing details…</p>}
    {current.error && <div className="finder-research-status"><p role="alert">{current.error}</p><button type="button" className="finder-secondary-button" onClick={onRetryResearch}>Retry details</button></div>}
    <div className="finder-original-heading"><span className="finder-overline">Listing details</span></div>
    <div className="finder-source-note"><Info size={17} />{community
      ? <p><strong>Community location report.</strong> Submitted {submissionDate(community.submittedAt)}. {community.observedOn ? `Observed on ${community.observedOn}.` : "Observation date not reported."} Submission time is not an inspection date. The team has not inspected this restroom.</p>
      : <p><strong>City data, dated {sourceDateLabel}.</strong> These are published details, not a live availability check or a team inspection.</p>}</div>
    {access && <div className="finder-source-note"><Info size={17} /><p><strong>Hours and entrance report.</strong> {accessDetailsProvenance(access)}. {access.limitations}</p></div>}

    <section className="finder-detail-section" aria-label="Hours">
      <h3><Clock size={19} aria-hidden="true" />Hours</h3>
      <details className="finder-hours-schedule">
      <summary><span>{hoursSummary.label}</span><strong>{hoursSummary.text}</strong><span>Full schedule &amp; sources</span></summary>
      <dl>
        {showListedHours && <FactRow label={reportedHours ? "Restroom hours — report" : "Listed restroom hours"} value={hours ?? "Hours unknown"} unknown={hours === null} />}
        {showOriginal(["seasonality"], restroom.seasonality, !restroom.seasonality) && <FactRow label="Seasonality" value={fact(restroom.seasonality)} unknown={!restroom.seasonality} />}
        {rows("hours", hourFacts)}
      </dl>
      </details>
      <p className="finder-field-note">Venue hours and restroom hours may differ. Published schedules do not confirm the restroom is open now.</p>
    </section>

    <section className="finder-detail-section" aria-label="Entry">
      <h3><DoorOpen size={19} />Entry</h3>
      <dl>
        {community && showOriginal(["entryRule"], entryLabels[community.entryRule], community.entryRule === "unknown", ["restroom", "route"]) && <FactRow label="Entry permission — report" value={entryLabels[community.entryRule]} unknown={community.entryRule === "unknown"} />}
        {showOriginal(["codeRequired", "passcodeRequired"], codeRequiredLabels[community?.passcodeRequired ?? "unknown"], !community?.passcodeRequired || community.passcodeRequired === "unknown", ["restroom", "route"]) && <FactRow label={community ? "Code required — report" : "Code required"} value={codeRequiredLabels[community?.passcodeRequired ?? "unknown"]} unknown={!community?.passcodeRequired || community.passcodeRequired === "unknown"} />}
        {showOriginal(["purchaseRequired"], restroom.purchaseRequired === null ? null : restroom.purchaseRequired ? "yes" : "no", restroom.purchaseRequired === null, ["restroom", "route"]) && <FactRow label="Purchase required" value={restroom.purchaseRequired === null ? "Not reported" : restroom.purchaseRequired ? "Yes" : "No"} unknown={restroom.purchaseRequired === null} />}
        {restroom.address && <FactRow label="Address" value={restroom.address} />}
        {showOriginal(["accessNotes", "accessRestriction"], restroom.accessNotes, !restroom.accessNotes) && <FactRow label="Access notes" value={fact(restroom.accessNotes)} unknown={!restroom.accessNotes} />}
        {rows("entryRoute", entryFacts)}
      </dl>
      <p className="finder-field-note">{access ? "Hours and entrance details are a dated report. They do not establish entry permission or confirm the restroom is open now." : community ? "Entry permission is a community report. Hours and availability have not been confirmed." : "Hours and status come from the dated source. They do not confirm the restroom is open now."}</p>
    </section>

    <section className="finder-detail-section" aria-label="Route inside">
      <h3><Footprints size={19} />Route inside</h3>
      <dl>
        {showOriginal(["entranceLocation"], access?.entranceLocation, !access?.entranceLocation, ["restroom", "route"]) && <FactRow label="Entrance location" value={fact(access?.entranceLocation)} unknown={!access?.entranceLocation} />}
        {showOriginal(["entranceStepFree"], access?.entranceStepFree, !access || access.entranceStepFree === "unknown", ["restroom", "route"]) && <FactRow label="Step-free entrance" value={routeLabels[access?.entranceStepFree ?? "unknown"]} unknown={!access || access.entranceStepFree === "unknown"} />}
        {showOriginal(["restroomFloor"], floor, !floor, ["restroom", "route"]) && <FactRow label="Restroom floor" value={fact(floor)} unknown={!floor} />}
        {showOriginal(["stairsAfterEntry", "stairsToRestroom"], access?.stairsAfterEntry?.toString() ?? restroom.stairsToRestroom, access?.stairsAfterEntry == null && !restroom.stairsToRestroom, ["restroom", "route"]) && (access?.stairsAfterEntry !== null && access?.stairsAfterEntry !== undefined
          ? <FactRow label="Stairs after entry" value={String(access.stairsAfterEntry)} />
          : <FactRow label="Stairs to restroom" value={fact(restroom.stairsToRestroom)} unknown={!restroom.stairsToRestroom} />)}
        {showOriginal(["stairFreeRoute"], stairFree, stairFree === "unknown", ["restroom", "route"]) && <FactRow label="Step-free route from street to restroom" value={routeLabels[stairFree]} unknown={stairFree === "unknown"} />}
        {showOriginal(["elevatorToRestroom"], elevator, elevator === "unknown", ["restroom", "route"]) && <FactRow label="Elevator to restroom" value={routeLabels[elevator]} unknown={elevator === "unknown"} />}
        {showOriginal(["elevatorNote"], access?.elevatorNote, !access?.elevatorNote, ["restroom", "route"]) && <FactRow label="Elevator route" value={fact(access?.elevatorNote)} unknown={!access?.elevatorNote} />}
        {rows("entryRoute", routeFacts)}
      </dl>
      <p className="finder-field-note">Check route details and source dates. Stall features and current availability are not confirmed.</p>
    </section>

    <section className="finder-detail-section" aria-label="Amenities">
      <h3><Building2 size={19} />Amenities</h3>
      <dl>
        {showOriginal(["restroomAccessibility"], ACCESSIBILITY_VALUES[accessibility], accessibility === "unknown", ["restroom", "route"]) && <FactRow label="Accessible" value={ACCESSIBILITY_VALUES[accessibility]} unknown={accessibility === "unknown"} />}
        {showOriginal(["restroomType"], restroom.restroomType, !restroom.restroomType) && <FactRow label="Restroom type" value={fact(restroom.restroomType)} unknown={!restroom.restroomType} />}
        {showOriginal(["changingStations"], restroom.changingStations, !restroom.changingStations) && <FactRow label={community ? "Changing stations" : "Changing stations — city label"} value={fact(restroom.changingStations)} unknown={!restroom.changingStations} />}
        {rows("amenities")}
      </dl>
      <p className="finder-field-note">A fixture count describes the inspection, not stocked supplies. Building accessibility does not establish the complete restroom route.</p>
    </section>

    <section className="finder-detail-section" aria-label="Conditions">
      <h3>Conditions</h3><dl>
        {showOriginal(["condition", "cleanliness", "inspectionRating", "conditionDetail"], restroom.cleanliness, !restroom.cleanliness, ["restroom", "route"]) && <FactRow label="Conditions" value={fact(restroom.cleanliness)} unknown={!restroom.cleanliness} />}
        {showOriginal(["publishedStatus", "closure"], restroom.publishedStatus, !restroom.publishedStatus) && <FactRow label="Published status" value={fact(restroom.publishedStatus)} unknown={!restroom.publishedStatus} />}
        {(restroom.observationDate || !profile?.sources.some(source => source.observedOn !== null)) && showOriginal(["inspectionDate"], restroom.observationDate, !restroom.observationDate, ["restroom", "route"]) && <FactRow label="Observation date" value={fact(restroom.observationDate)} unknown={!restroom.observationDate} />}
        {rows("conditions")}
      </dl><p className="finder-field-note">Dated inspections and published reports describe their source dates. They do not establish current condition or app cleanliness ratings.</p>
    </section>

    {(passcodeContent || inSection("passcodes").length > 0) && <div className="finder-detail-section">
      {passcodeContent || <h3>Passcodes</h3>}
      {inSection("passcodes").length > 0 && <div className="finder-research-published-codes"><h4>Published code information</h4><dl>{rows("passcodes")}</dl><p className="finder-field-note">Published code claims are unverified. They do not add confirmations, establish entry permission, or change shared-code order.</p></div>}
    </div>}

    <section className="finder-detail-section finder-rate-comment" aria-label="Rate and Comment">
      <h3><MessageSquareText size={19} aria-hidden="true" />Rate and Comment</h3>
      <div className="finder-research-contribution">{ratingContent}</div>
      {inSection("ratings").length > 0 && <div className="finder-research-contribution"><h4>Published ratings</h4><dl>{rows("ratings")}</dl><p className="finder-field-note">External venue scores are separate from visitor cleanliness ratings in this app.</p></div>}
      {visitReportContent && <div className="finder-research-contribution">{visitReportContent}</div>}
      <div className="finder-research-contribution">{personalContent}</div>
      {profile && profile.comments.length > 0 && <div className="finder-research-contribution"><h4>Published comments</h4><CardResearchComments profile={profile} /></div>}
      <SourceComments key={restroom.id} placeID={restroom.id} excludeIDs={coveredIDs} inline />
    </section>

    <details className="finder-provenance">
      <summary>Source & record details</summary>
      {profile && <div className="finder-research-source-limits">{profile.sources.map(source => <div key={source.id}><a href={source.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{source.title}</a><p>{source.displayedDate || "Publication date not shown"}. {source.limitations}</p></div>)}</div>}
      <SourceReports placeID={restroom.id} />
      {access && <><p>Hours and entrance source: {accessDetailsProvenance(access)}.</p><p>Report updated {accessDetailsDate(access.updatedAt)}. Update time is not an inspection date. {access.limitations}</p></>}
      {community ? <><p>Source: a community location report. Check access notes for any source details. Contributor account identities are private.</p>
        <p>Submitted {submissionDate(community.submittedAt)}. Observation date: {community.observedOn ?? "Not reported"}. Submission time is not an inspection date.</p>
        <p>Chosen coordinates: {restroom.latitude.toFixed(6)}, {restroom.longitude.toFixed(6)}. The address and pin are visitor reports.</p>
        <p>Submission record: {restroom.id}. Contact the project team to request a correction or removal.</p>
      </> : <><p>Publisher: {datasetSource.publisher}. Operator: {fact(restroom.operator)}.</p>
      <p>Original source accessibility value: {fact(restroom.facilityAccessibility)}.</p>
      <p>Source data updated {sourceDateLabel}. Retrieved {new Date(datasetSource.retrievedAt).toLocaleDateString("en-US", { timeZone: "America/New_York" })}. Retrieval is not an inspection date.</p>
      <p>Source record{restroom.sourceRecordIds.length > 1 ? "s" : ""}: {restroom.sourceRecordIds.join(", ")}</p>
      <a href={restroom.sourceUrl ?? datasetSource.url} target="_blank" rel="noreferrer">View NYC Open Data source <ArrowUpRight size={15} /></a>
      </>}
      {restroom.website && /^https?:\/\//i.test(restroom.website) && <a href={restroom.website} target="_blank" rel="noreferrer">Visit venue website <ArrowUpRight size={15} /></a>}
    </details>
  </aside>;
}
