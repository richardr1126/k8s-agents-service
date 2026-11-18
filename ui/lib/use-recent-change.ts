import { useEffect, useState } from "react";

/** How long after the last change a value still counts as changing, so streams don't flicker between chunks. */
export const RECENT_CHANGE_MS = 900;

/** True while `value` keeps changing (and `active`), until it has been still for `graceMs`. */
export function useRecentChange(value: unknown, active: boolean, graceMs = RECENT_CHANGE_MS) {
  const [seen, setSeen] = useState(value);
  const [changing, setChanging] = useState(false);
  if (!Object.is(value, seen)) {
    setSeen(value);
    if (active) setChanging(true);
  }
  useEffect(() => {
    if (!changing) return;
    const timer = setTimeout(() => setChanging(false), graceMs);
    return () => clearTimeout(timer);
  }, [changing, value, graceMs]);
  return active && changing;
}
