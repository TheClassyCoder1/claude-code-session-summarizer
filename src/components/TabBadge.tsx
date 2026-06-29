"use client";

import { useEffect } from "react";

// Prefixes the browser-tab title with the count of sessions needing attention
// (Waiting for you + Finished), so it shows beside the favicon. Re-runs on each
// RSC refresh (AutoRefresh) since `count` is recomputed server-side per render.
export default function TabBadge({
  count,
  base = "Claude Session Dashboard",
}: {
  count: number;
  base?: string;
}) {
  useEffect(() => {
    document.title = count > 0 ? `(${count}) ${base}` : base;
  }, [count, base]);
  return null;
}
