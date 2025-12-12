import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getIsAnonymous(user: unknown): boolean {
  if (!user || typeof user !== "object") return false;
  return (user as Record<string, unknown>).isAnonymous === true;
}
