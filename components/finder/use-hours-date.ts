"use client";

import { useEffect, useState } from "react";
import { millisecondsUntilNextNewYorkDay } from "@/lib/hours-schedule";

/** Refresh today's label after NYC midnight and when a sleeping tab returns. */
export function useHoursDate(): Date | null {
  const [date, setDate] = useState<Date | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let active = true;
    const refresh = () => {
      if (!active) return;
      clearTimeout(timer);
      const now = new Date();
      setDate(now);
      timer = setTimeout(refresh, millisecondsUntilNextNewYorkDay(now) + 50);
    };
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return date;
}
