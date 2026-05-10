import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// Shared class merging stays here so feature folders can stay focused on
// domain and rendering logic instead of repeating Tailwind composition glue.
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
