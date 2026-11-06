import { ArrowUpRight, FileText } from "lucide-react";
import { formatSourceDate, groupSourceFacts, SOURCE_DATE_LABELS, SOURCE_FACT_LABELS, sourceReportsForPlace } from "@/lib/source-reports";
import styles from "./source-reports.module.css";

export function SourceReports({ placeID }: { placeID: string }) {
  const reports = sourceReportsForPlace(placeID);
  if (reports.length === 0) return null;

  return <section className={styles.section} aria-label="2026 source reports">
    <h3 className={styles.heading}><FileText size={19} aria-hidden="true" />2026 source reports</h3>
    <p className={styles.intro}>Additional published reports for this location. Web source dates are not visit or inspection dates. These details may differ from the listing or other reports.</p>
    <div className={styles.reports}>
      {reports.map((report) => <article className={styles.report} key={report.id}>
        <header className={styles.reportHeader}>
          <p className={styles.venue}>{report.venueLabel}</p>
          <a className={styles.sourceLink} href={report.source.url} target="_blank" rel="noopener noreferrer">{report.source.title}<ArrowUpRight size={14} aria-hidden="true" /><span className={styles.srOnly}> (opens in a new tab)</span></a>
          <p className={styles.date}>{report.source.sourceType === "discussion" && ["published", "post"].includes(report.source.dateKind) ? "Discussion started" : SOURCE_DATE_LABELS[report.source.dateKind]} <time dateTime={report.source.publishedOn}>{formatSourceDate(report.source.publishedOn)}</time></p>
          {report.reportedOn && (report.source.sourceType === "discussion" || report.reportedOn !== report.source.publishedOn) && <p className={styles.date}>{report.source.sourceType === "discussion" ? "Comment posted" : "Report posted"} <time dateTime={report.reportedOn}>{formatSourceDate(report.reportedOn)}</time></p>}
          {!report.reportedOn && report.source.sourceType === "discussion" && report.source.dateKind !== "comment" && <p className={styles.date}>Comment date not reported.</p>}
          <p className={styles.observation}>Observation date not reported.</p>
        </header>
        {groupSourceFacts(report.facts).map((group) => <section className={styles.group} key={group.label}>
          <h4>{group.label}</h4>
          <dl className={styles.facts}>{group.facts.map((fact, index) => <div className={styles.fact} key={`${fact.field}-${index}`}>
            <dt>{SOURCE_FACT_LABELS[fact.field]}</dt><dd>{fact.value}</dd>
          </div>)}</dl>
        </section>)}
        {report.facts.some((fact) => ["elevatorAccess", "buildingAccessibility", "restroomAccessibility", "stepFreeAccess"].includes(fact.field)) && <p className={styles.caution}>An elevator or an accessibility description alone does not establish the complete route or stall features.</p>}
        {(report.limitations || report.source.limitations) && <details className={styles.limitations}>
          <summary>Source limits</summary>
          {report.limitations && <p>{report.limitations.startsWith("Preserve venueLabel.")
            ? "These details apply only to the named restroom. Other restrooms within this listing have separate hours."
            : report.limitations}</p>}
          {report.source.limitations && report.source.limitations !== report.limitations && <p>{report.source.limitations}</p>}
        </details>}
      </article>)}
    </div>
  </section>;
}
