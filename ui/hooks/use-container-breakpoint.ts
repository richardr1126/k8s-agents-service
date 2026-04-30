"use client";

import { useEffect, useRef, useState } from "react";

export function useContainerBreakpoint<T extends HTMLElement>(breakpointPx: number) {
  const containerRef = useRef<T | null>(null);
  const [isNarrow, setIsNarrow] = useState(false);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const update = (width: number) => {
      setIsNarrow(width < breakpointPx);
    };

    if (typeof ResizeObserver === "undefined") {
      update(node.getBoundingClientRect().width);
      const onResize = () => update(node.getBoundingClientRect().width);
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }

    update(node.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      update(entry.contentRect.width);
    });
    observer.observe(node);

    return () => observer.disconnect();
  }, [breakpointPx]);

  return { containerRef, isNarrow };
}
