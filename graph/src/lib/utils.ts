import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatDistanceToNowStrict } from "date-fns";
import type { Memory, TaskStatus } from "@/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function rel(iso: string | number | null | undefined): string {
  if (iso === null || iso === undefined || iso === "") return "—";
  const d = typeof iso === "number" ? new Date(iso * 1000) : new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return formatDistanceToNowStrict(d, { addSuffix: true });
}

export const isPinned = (m: Pick<Memory, "tags">) => m.tags.includes("pinned:true") || m.tags.includes("pinned");

export function taskStatus(m: Pick<Memory, "tags">): TaskStatus {
  const t = m.tags.find((x) => x.startsWith("status:"));
  const s = t?.slice(7);
  return s === "doing" || s === "done" || s === "blocked" ? s : "todo";
}

export const taskAgent = (m: Pick<Memory, "tags">) => m.tags.find((x) => x.startsWith("agent:"))?.slice(6);

export function withStatus(tags: string[], status: TaskStatus): string[] {
  return [...tags.filter((t) => !t.startsWith("status:")), `status:${status}`];
}

export function splitList(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function copy(text: string) {
  void navigator.clipboard?.writeText(text);
}

export const isTyping = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
};
