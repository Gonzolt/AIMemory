import type { MemoryType } from "@/types";

export const TYPE_COLORS: Record<MemoryType, { fill: string; ring: string }> = {
  user: { fill: "#7e95b8", ring: "#a7bad6" },
  feedback: { fill: "#9b8f6f", ring: "#c5ba98" },
  project: { fill: "#6c8b7f", ring: "#93b3a6" },
  reference: { fill: "#7b7b8e", ring: "#a0a0b3" },
  decision: { fill: "#8a738a", ring: "#b095b0" },
  conversation: { fill: "#5f7a91", ring: "#85a3bb" },
  code: { fill: "#6f7d5f", ring: "#95a283" },
  task: { fill: "#b08a5c", ring: "#d4b48a" },
};

export const typeFill = (t: string) => TYPE_COLORS[t as MemoryType]?.fill ?? "#777";
export const typeRing = (t: string) => TYPE_COLORS[t as MemoryType]?.ring ?? "#999";

// muted categorical palette for project/agent colouring
const PALETTE = ["#7e95b8", "#9b8f6f", "#6c8b7f", "#8a738a", "#5f7a91", "#b08a5c", "#6f7d5f", "#a07070", "#7b7b8e", "#6b8e9e"];

export function hashColor(key: string | undefined): string {
  if (!key) return "#555";
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

/** fresh → bright, old → dim. */
export function ageColor(updated: string): string {
  const days = Math.max(0, (Date.now() - Date.parse(updated)) / 86400000);
  const t = Math.min(1, Math.sqrt(days / 90));
  const l = Math.round(78 - t * 46);
  return `hsl(210 22% ${l}%)`;
}

export const EDGE_COLORS: Record<string, string> = {
  default: "rgba(170,180,195,0.55)",
  conflicts_with: "rgba(220,120,120,0.7)",
  supersedes: "rgba(180,170,120,0.7)",
};
