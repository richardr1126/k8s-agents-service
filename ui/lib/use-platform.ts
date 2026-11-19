"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

/** Whether this is a Mac, for showing ⌘ rather than Ctrl. False on the server. */
export function useIsMac() {
  return useSyncExternalStore(
    noop,
    () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent),
    () => false,
  );
}
