import { isOneOf } from "@/modules/shared/lib/guards";

export const THEME_STORAGE_KEY = "atlas-theme";
export const THEMES = ["dark", "light"] as const;

export type Theme = (typeof THEMES)[number];

export function isTheme(value: unknown): value is Theme {
  return isOneOf(value, THEMES);
}

export function getStoredTheme(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(value) ? value : null;
  } catch {
    return null;
  }
}

export function getDocumentTheme(): Theme | null {
  const value = document.documentElement.getAttribute("data-theme");
  return isTheme(value) ? value : null;
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage can be unavailable in private or embedded contexts; the theme still applies.
  }
}
