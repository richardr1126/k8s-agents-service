import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Cookie saying the user had conversations last visit; it picks the boot skeleton. */
export const HAD_THREADS_COOKIE = "chat-had-threads";
