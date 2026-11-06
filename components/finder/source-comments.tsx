"use client";

import { useEffect, useId, useState } from "react";
import { ArrowUpRight, MessageSquareText } from "lucide-react";
import { formatSourceCommentDate, formatSourceCommentInstant, sourceCommentAttribution, watchSourceComments, type SourceComment } from "@/lib/source-comments";
import styles from "./source-comments.module.css";

function SourceDate({ comment }: { comment: SourceComment }) {
  if (!comment.publishedOn) return <span>{comment.dateStatus === "unknown-year"
    ? (comment.displayedDate ? `${comment.displayedDate} · year unknown` : "Publication year not shown")
    : "Publication date not shown"}</span>;
  return <>
    <time dateTime={comment.publishedOn}>{formatSourceCommentDate(comment.publishedOn)}</time>
    {comment.dateStatus === "resolved-relative" && <span> (approx.)</span>}
  </>;
}

export function uncoveredSourceComments(comments: readonly SourceComment[], excludeIDs: readonly string[]): SourceComment[] {
  return comments.filter(comment => !excludeIDs.includes(comment.id));
}

/** Presentation only; the reader supplies strictly decoded, place-scoped records. */
export function SourceCommentList({ comments, excludeIDs = [] }: { comments: readonly SourceComment[]; excludeIDs?: readonly string[] }) {
  return <div className={styles.comments}>{uncoveredSourceComments(comments, excludeIDs).map((comment) => <article className={styles.comment} key={comment.id}>
    <header className={styles.commentHeader}>
      <p className={styles.author}>{comment.displayName}<span className={styles.kind}>{sourceCommentAttribution(comment)}</span></p>
      <p className={styles.sourceDate}>English paraphrase<span aria-hidden="true"> · </span><SourceDate comment={comment} /></p>
    </header>
    <p className={styles.text}>{comment.text}</p>
    <p className={styles.reportStatus}>Imported, unverified source report</p>
    <details className={styles.sourceDetails}>
      <summary>Source and limits</summary>
      {comment.sourceURL ? <a className={styles.sourceLink} href={comment.sourceURL} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
        {comment.sourceTitle}<ArrowUpRight size={14} aria-hidden="true" /><span className={styles.srOnly}> (opens in a new tab)</span>
      </a> : <p className={styles.sourceTitle}>{comment.sourceTitle} · Source link not available</p>}
      <dl className={styles.dates}>
        {comment.displayedDate && <div><dt>Displayed source date</dt><dd>{comment.displayedDate}</dd></div>}
        <div><dt>Source retrieved</dt><dd><time dateTime={comment.capturedAt.toISOString()}>{formatSourceCommentInstant(comment.capturedAt)}</time></dd></div>
        <div><dt>Imported</dt><dd><time dateTime={comment.submittedAt.toISOString()}>{formatSourceCommentInstant(comment.submittedAt)}</time></dd></div>
      </dl>
      {!comment.publishedOn && <p>Retrieval and import dates do not establish a publication or visit date.</p>}
      <p>{comment.limitations}</p>
    </details>
  </article>)}</div>;
}

export function SourceComments({ placeID, excludeIDs = [], inline = false }: { placeID: string; excludeIDs?: readonly string[]; inline?: boolean }) {
  const headingID = useId();
  const [retry, setRetry] = useState(0);
  const [feed, setFeed] = useState<{ placeID: string; comments: SourceComment[]; loading: boolean; error: string | null }>(
    { placeID, comments: [], loading: true, error: null });
  const current = feed.placeID === placeID ? feed : { placeID, comments: [], loading: true, error: null };
  useEffect(() => {
    let active = true;
    setFeed({ placeID, comments: [], loading: true, error: null });
    const unsubscribe = watchSourceComments(placeID, (comments) => {
      if (active) setFeed({ placeID, comments, loading: false, error: null });
    }, (error) => {
      if (active) setFeed((previous) => ({ placeID, comments: previous.placeID === placeID ? previous.comments : [], loading: false, error: error.message }));
    });
    return () => { active = false; unsubscribe(); };
  }, [placeID, retry]);

  const comments = uncoveredSourceComments(current.comments, excludeIDs);
  if (!current.loading && !current.error && comments.length === 0) return null;
  return <section className={inline ? styles.inline : styles.section} aria-labelledby={headingID}>
    <h3 className={styles.heading} id={headingID}><MessageSquareText size={19} aria-hidden="true" />Published comments</h3>
    {current.loading && <p className={styles.status} role="status">Loading published comments…</p>}
    {current.error && <div className={styles.error}><p role="alert">{current.error}</p><button type="button" onClick={() => setRetry((value) => value + 1)}>Retry comments</button></div>}
    {comments.length > 0 && <SourceCommentList comments={comments} />}
  </section>;
}
