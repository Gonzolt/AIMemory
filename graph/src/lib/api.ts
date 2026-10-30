import type { AimEvent, CodeHit, GraphData, Memory, ProjectSummary, SimilarPair } from "@/types";

const BASE = "/api";

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `${res.status} ${res.statusText}`);
  return data as T;
}

const post = <T>(path: string, body?: unknown) => j<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) });

export const fetchGraph = () => j<GraphData>("/graph");
export const fetchMemory = (id: string) => j<Memory>(`/memory/${encodeURIComponent(id)}`);

export async function searchMemory(q: string, type?: string, limit = 30): Promise<Memory[]> {
  const p = new URLSearchParams({ q, limit: String(limit) });
  if (type) p.set("type", type);
  return (await j<{ results: Memory[] }>(`/search?${p}`)).results;
}

export interface NewMemory {
  type: string;
  title: string;
  body: string;
  id?: string;
  agents?: string[];
  projects?: string[];
  tags?: string[];
  confidence?: string;
  status?: string;
}

export const createMemory = (m: NewMemory) =>
  post<{ id: string; type: string; title: string; path: string; updated: string }>("/memory", m);
export const updateMemory = (id: string, patch: Partial<NewMemory>) =>
  j<{ ok: boolean; id: string; updated: string }>(`/memory/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });
export const deleteMemory = (id: string) =>
  j<{ ok: boolean; id: string }>(`/memory/${encodeURIComponent(id)}`, { method: "DELETE" });
export const linkMemories = (src: string, dst: string, kind = "mentions") =>
  post<{ ok: boolean; src: string; dst: string; kind: string }>("/link", { src, dst, kind });

export const fetchProjects = async () => (await j<{ projects: ProjectSummary[] }>("/projects")).projects;
export async function codeSearch(q: string, project?: string, limit = 40): Promise<CodeHit[]> {
  const p = new URLSearchParams({ q, limit: String(limit) });
  if (project) p.set("project", project);
  return (await j<{ results: CodeHit[] }>(`/code/search?${p}`)).results;
}

export const fetchDuplicates = async () => (await j<{ pairs: SimilarPair[] }>("/duplicates")).pairs;
export const fetchSuggestLinks = async () => (await j<{ pairs: SimilarPair[] }>("/suggest-links")).pairs;
export const fetchStale = (days = 30) =>
  j<{ days: number; items: { id: string; type: string; title: string; updated: string; tags: string }[] }>(
    `/stale?days=${days}`,
  );

export const getSummary = (id: string) => j<{ id: string; summary: string | null }>(`/summary/${encodeURIComponent(id)}`);
export const makeSummary = (id: string) => post<{ id: string; summary: string }>(`/summary/${encodeURIComponent(id)}`);

export const runSync = () => post<{ ok: boolean; stdout: string; stderr: string }>("/sync");
export const dispatchTask = (id: string, runner: "claude" | "codex") =>
  post<{ ok: boolean; task_id: string; runner: string; pid: number; log: string }>("/dispatch", { id, runner });
export const stopDispatch = (id: string) =>
  post<{ ok: boolean; stopped?: boolean; already_exited?: boolean }>(`/dispatch/${encodeURIComponent(id)}/stop`);
export const dispatchLog = (id: string, lines = 500) =>
  j<{ id: string; exists: boolean; lines: string[]; path: string; bytes: number; running?: boolean }>(
    `/dispatch-log/${encodeURIComponent(id)}?lines=${lines}`,
  );

export const ask = (q: string) =>
  post<{ answer: string; cited: string[]; context: { id: string; title: string; type: string }[] }>("/ask", { q });
export const fetchPresence = () =>
  j<{ agents: { name: string; installed: boolean; live: boolean; last: number | null }[]; now: number }>("/presence");
export const runDemo = () => post<{ ok: boolean; pid: number }>("/demo");
export const runBenchmark = (prompt: string, runner: "claude" | "codex", name?: string, save = true) =>
  post<{ ok: boolean; runner: string; elapsed_s: number; output: string; saved_id: string | null }>("/benchmark", {
    prompt,
    runner,
    name,
    save,
  });
export const fetchEvents = async (limit = 60) => (await j<{ events: AimEvent[] }>(`/events?limit=${limit}`)).events;

export function openLiveUpdates(onEvent: (e: AimEvent) => void, onStatus: (connected: boolean) => void): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let timer: number | undefined;
  const connect = () => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => onStatus(true);
    ws.onmessage = (m) => {
      try {
        onEvent(JSON.parse(m.data));
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onclose = () => {
      onStatus(false);
      if (!closed) timer = window.setTimeout(connect, 1500);
    };
    ws.onerror = () => ws?.close();
  };
  connect();
  return () => {
    closed = true;
    window.clearTimeout(timer);
    ws?.close();
  };
}
