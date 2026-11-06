"use client";

import { useEffect } from "react";

export function FinderRedirect() {
  useEffect(() => { window.location.replace("/find/"); }, []);
  return null;
}
