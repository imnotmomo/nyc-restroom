"use client";

import { useEffect, useRef, useState } from "react";
import { RestroomPasscodes } from "@/components/finder/passcodes";
import {
  deleteOwnPasscode, savePasscode, verifyOwnPasscode, verifyPublicPasscode,
  watchOwnPasscode, watchPublicPasscodes,
  type OwnPasscode, type PasscodeInput, type PublicPasscodeReport,
} from "@/lib/passcodes";

interface Props {
  placeID: string;
  uid: string | null;
  accountLoading: boolean;
  authError: string | null;
  onSignIn: () => void;
  onPrivateSaved: (uid: string, placeID: string) => void;
}

/** Selected-place listeners never share private state across account or place changes. */
export function PasscodePanel({ placeID, uid, accountLoading, authError, onSignIn, onPrivateSaved }: Props) {
  const scope = `${uid ?? "signed-out"}:${placeID}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const [retry, setRetry] = useState(0);
  const [own, setOwn] = useState<{ scope: string; record: OwnPasscode | null; loading: boolean; error: string | null } | null>(null);
  const [shared, setShared] = useState<{ placeID: string; records: PublicPasscodeReport[]; loading: boolean; error: string | null } | null>(null);
  const [action, setAction] = useState<{ scope: string; busy: boolean; error: string | null }>({ scope, busy: false, error: null });

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setShared({ placeID, records: [], loading: true, error: null });
    const unsubscribe = watchPublicPasscodes(placeID, (records) => {
      if (active) setShared({ placeID, records, loading: false, error: null });
    }, (error) => {
      if (active) setShared({ placeID, records: [], loading: false, error: error.message });
    });
    return () => { active = false; unsubscribe(); };
  }, [placeID, retry]);

  useEffect(() => {
    let active = true;
    inFlight.current = false;
    setAction({ scope, busy: false, error: null });
    if (!uid) { setOwn({ scope, record: null, loading: false, error: null }); return; }
    setOwn({ scope, record: null, loading: true, error: null });
    const unsubscribe = watchOwnPasscode(uid, placeID, (record) => {
      if (active && currentScope.current === scope) setOwn({ scope, record, loading: false, error: null });
    }, (error) => {
      if (active && currentScope.current === scope) setOwn({ scope, record: null, loading: false, error: error.message });
    });
    return () => { active = false; unsubscribe(); };
  }, [uid, placeID, scope, retry]);

  const ownState = own?.scope === scope ? own : null;
  const publicState = shared?.placeID === placeID ? shared : null;

  async function run(operation: () => Promise<void>, privateSave = false): Promise<boolean> {
    if (!uid || accountLoading || inFlight.current) return false;
    const owner = uid;
    const startedScope = scope;
    const isCurrent = () => mounted.current && currentScope.current === startedScope;
    inFlight.current = true;
    setAction({ scope, busy: true, error: null });
    try {
      await operation();
      if (!isCurrent()) return false;
      if (privateSave) onPrivateSaved(owner, placeID);
      return true;
    } catch (error) {
      if (isCurrent()) setAction({ scope, busy: true, error: error instanceof Error ? error.message : "Your passcode change could not be confirmed. Please retry." });
      return false;
    } finally {
      if (isCurrent()) {
        inFlight.current = false;
        setAction((value) => value.scope === scope ? { ...value, busy: false } : value);
      }
    }
  }

  function save(input: PasscodeInput, expected: OwnPasscode | null) {
    if (!uid || !ownState || ownState.loading || ownState.error) return Promise.resolve(false);
    return run(async () => {
      const record = await savePasscode(uid, placeID, input, expected);
      if (mounted.current && currentScope.current === scope) setOwn({ scope, record, loading: false, error: null });
    }, input.visibility === "private");
  }

  return <RestroomPasscodes placeID={placeID} uid={uid} accountLoading={accountLoading}
    authError={authError} onSignIn={onSignIn}
    ownPasscode={ownState?.record ?? null} publicReports={publicState?.records ?? []}
    ownLoading={Boolean(uid && (!ownState || ownState.loading))} publicLoading={!publicState || publicState.loading}
    ownError={ownState?.error ?? null} publicError={publicState?.error ?? null}
    busy={action.scope === scope && action.busy} actionError={action.scope === scope ? action.error : null}
    onSave={save}
    onDelete={(expected) => !uid ? Promise.resolve(false) : run(async () => {
      await deleteOwnPasscode(uid, placeID, expected);
      if (mounted.current && currentScope.current === scope) setOwn({ scope, record: null, loading: false, error: null });
    })}
    onVerifyOwn={(expected) => !uid ? Promise.resolve(false) : run(async () => {
      const record = await verifyOwnPasscode(uid, placeID, expected);
      if (mounted.current && currentScope.current === scope) setOwn({ scope, record, loading: false, error: null });
    }, expected.visibility === "private")}
    onVerifyPublic={(expected) => !uid ? Promise.resolve(false) : run(async () => {
      const report = await verifyPublicPasscode(uid, expected);
      if (mounted.current && currentScope.current === scope) setShared((value) => value?.placeID === placeID
        ? { ...value, records: value.records.map((item) => item.reportID === report.reportID ? report : item) } : value);
    })}
    onRetry={() => setRetry((value) => value + 1)} />;
}
