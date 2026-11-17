"use client";

import { useEffect, useState } from "react";
import { Toaster as Sonner } from "sonner";

/** Sonner, following the `dark` class the theme script sets on <html>. */
export function Toaster() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setTheme(root.classList.contains("dark") ? "dark" : "light");
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return <Sonner theme={theme} position="bottom-right" richColors closeButton duration={4000} />;
}
