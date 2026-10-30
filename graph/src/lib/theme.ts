export type Theme = "default" | "obsidian" | "slate" | "latte";

export const THEMES: { id: Theme; label: string; note: string; swatch: [string, string, string] }[] = [
  { id: "default", label: "Default", note: "True black", swatch: ["#0a0a0a", "#1f1f1f", "#ebebeb"] },
  { id: "obsidian", label: "Obsidian", note: "Warm dark, purple accent", swatch: ["#131318", "#3a2a4d", "#a78bfa"] },
  { id: "slate", label: "Slate", note: "Cool gray-blue", swatch: ["#0d131c", "#1e2836", "#a7bad6"] },
  { id: "latte", label: "Latte", note: "Light, warm cream", swatch: ["#faf7f3", "#ece6dc", "#2a241e"] },
];

const KEY = "boltramemory.theme";

export function getTheme(): Theme {
  try {
    return (localStorage.getItem(KEY) as Theme) || "default";
  } catch {
    return "default";
  }
}

export function applyTheme(t: Theme) {
  const root = document.documentElement;
  root.setAttribute("data-theme", t);
  root.classList.toggle("dark", t !== "latte");
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* private mode */
  }
}
