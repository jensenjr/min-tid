// "Felsökningsläge": a device-local switch (never synced) that reveals technical sync
// details — HTTP codes, server, session and key state, the error log and the two-step
// "Kopiera / Skicka" felanmälan. Off by default; normal users only see plain Swedish.

import { useEffect, useState } from "react";

export const DEBUG_MODE_KEY = "punchclock_debug";
const EVENT = "punchclock-debug-change";

export function readDebugMode(): boolean {
  try {
    return localStorage.getItem(DEBUG_MODE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeDebugMode(on: boolean): void {
  try {
    if (on) localStorage.setItem(DEBUG_MODE_KEY, "1");
    else localStorage.removeItem(DEBUG_MODE_KEY);
  } catch {
    /* storage unavailable — the switch just won't stick */
  }
  window.dispatchEvent(new Event(EVENT));
}

/** Current value, kept in step across components (and tabs). */
export function useDebugMode(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(readDebugMode);
  useEffect(() => {
    const update = () => setOn(readDebugMode());
    window.addEventListener(EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, []);
  return [on, writeDebugMode];
}
