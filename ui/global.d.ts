declare module "*.css";

interface Window {
  /** Set by the theme script in app/layout.tsx; null follows the system. */
  __setTheme?: (theme: "light" | "dark" | null) => void;
}
