"use client";

import { useSyncExternalStore } from "react";

/** Subscribes to a CSS media query. Server and first client render agree on `false`, so hydration is always safe. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", notify);
      return () => mql.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export const useReducedMotion = () => useMediaQuery("(prefers-reduced-motion: reduce)");

type NetworkInformation = { saveData?: boolean; effectiveType?: string };

/** True when the visitor has asked to save data or is on a slow connection: heavy media should then stay as still images. */
export function useDataSaver(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => {
      const c = (navigator as Navigator & { connection?: NetworkInformation }).connection;
      return Boolean(c?.saveData || (c?.effectiveType && /^(slow-2g|2g|3g)$/.test(c.effectiveType)));
    },
    () => false,
  );
}
