"use client";

import { useEffect, useRef, useState } from "react";
import { RestroomPasscodes } from "@/components/finder/passcodes";
import { useFirebaseAccount } from "@/components/firebase-account";
import {
  deleteCodeReport, newCodeReportID, reportNewCode, setCodeFeedback, setCodeVisibility, verifyPrivateCode, watchCodeEvidence,
  type CodeEvidence, type CodeEvidenceState,
} from "@/lib/code-reports";

interface Props {
  placeID: string;
  uid: string | null;
  accountLoading: boolean;
  authError: string | null;
  onSignIn: () => void;
  onPrivateSaved: (uid: string, placeID: string) => void;
}
type Context = { scope: string; session: object | null };
function emptyEvidence(uid: string | null): CodeEvidenceState {
  return { records: [], publicLoading: true, ownLoading: Boolean(uid), feedbackLoading: true,
    publicError: null, ownError: null, feedbackError: null };
}

/** One selected-place subscription; old callbacks cannot publish into a new account generation. */
export function PasscodePanel({ placeID, uid, accountLoading, authError, onSignIn, onPrivateSaved }: Props) {
  const session = useFirebaseAccount().user;
  const scope = JSON.stringify([uid, placeID]);
  const context = useRef<Context>({ scope, session });
  if (context.current.scope !== scope || context.current.session !== session) context.current = { scope, session };
  const owner = context.current;
  const mounted = useRef(true);
  const inFlight = useRef<object | null>(null);
  const [retry, setRetry] = useState(0);
  const [feed, setFeed] = useState(() => ({ owner, value: emptyEvidence(uid) }));
  const [action, setAction] = useState({ owner, busy: false, error: null as string | null });

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; inFlight.current = null; };
  }, []);
  useEffect(() => {
    let active = true;
    inFlight.current = null;
    setAction({ owner, busy: false, error: null });
    setFeed({ owner, value: emptyEvidence(uid) });
    const unsubscribe = watchCodeEvidence(placeID, uid, (value) => {
      if (active && context.current === owner) setFeed({ owner, value });
    });
    return () => { active = false; unsubscribe(); };
  }, [uid, placeID, owner, retry]);

  const evidence = feed.owner === owner ? feed.value : emptyEvidence(uid);
  async function run(operation: () => Promise<void>, privateSave = false): Promise<boolean> {
    if (!uid || accountLoading || inFlight.current) return false;
    const started = owner;
    const accountUID = uid;
    const operationToken = {};
    const isCurrent = () => mounted.current && context.current === started && inFlight.current === operationToken;
    inFlight.current = operationToken;
    setAction({ owner, busy: true, error: null });
    try {
      await operation();
      if (!isCurrent()) return false;
      if (privateSave) onPrivateSaved(accountUID, placeID);
      return true;
    } catch (error) {
      if (isCurrent()) setAction({ owner, busy: true, error: error instanceof Error ? error.message : "Your code change could not be confirmed. Retry the same request." });
      return false;
    } finally {
      if (isCurrent()) { inFlight.current = null; setAction((value) => value.owner === owner ? { ...value, busy: false } : value); }
    }
  }
  function ownAction(expected: CodeEvidence, operation: () => Promise<void>, privateSave = false) {
    if (!uid || expected.placeID !== placeID || expected.ownership !== "own" || evidence.ownLoading || evidence.ownError) return Promise.resolve(false);
    return run(operation, privateSave);
  }

  return <RestroomPasscodes placeID={placeID} uid={uid} accountLoading={accountLoading} accountGeneration={owner} evidence={evidence}
    authError={authError} onSignIn={onSignIn} newReportID={newCodeReportID}
    busy={action.owner === owner && action.busy} actionError={action.owner === owner ? action.error : null}
    onReport={(attempt) => !uid || evidence.ownLoading || evidence.ownError ? Promise.resolve(false)
      : run(() => reportNewCode(uid, placeID, attempt.id, attempt.input), attempt.input.visibility === "private")}
    onVisibility={(expected, visibility) => ownAction(expected, () => setCodeVisibility(uid!, expected, visibility), visibility === "private")}
    onDelete={(expected) => ownAction(expected, () => deleteCodeReport(uid!, expected))}
    onVerifyPrivate={(expected) => expected.visibility !== "private" ? Promise.resolve(false)
      : ownAction(expected, () => verifyPrivateCode(uid!, expected), true)}
    onFeedback={(expected, vote) => !uid || expected.placeID !== placeID || expected.ownership !== "other" || !expected.feedbackLoaded
      ? Promise.resolve(false) : run(() => setCodeFeedback(uid, expected, vote))}
    onRetry={() => setRetry((value) => value + 1)} />;
}
