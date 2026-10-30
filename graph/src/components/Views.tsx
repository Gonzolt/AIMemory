import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download, Loader2, Play, RefreshCw, Search } from "lucide-react";
import type { AimEvent, CodeHit, Memory, MemoryType, ProjectSummary } from "@/types";
import { MEMORY_TYPES } from "@/types";
import { codeSearch, fetchEvents, fetchPresence, fetchProjects, runBenchmark, runSync } from "@/lib/api";
import { typeFill } from "@/lib/colors";
import { THEMES, applyTheme, getTheme, type Theme } from "@/lib/theme";
import { toast } from "@/lib/toast";
import { bytes, cn, isPinned, rel } from "@/lib/utils";
import { Button, Card, Empty, Input, SectionLabel, Select, TypeChip } from "./ui";

// ------------------------------------------------------------------ MemoriesView

export function MemoriesView({ memories, onOpen }: { memories: Memory[]; onOpen: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [type, setType] = useState<"" | MemoryType>("");
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return memories
      .filter((m) => (!type || m.type === type) && (!s || m.title.toLowerCase().includes(s) || m.id.includes(s) || m.tags.some((t) => t.includes(s))))
      .sort((a, b) => b.updated.localeCompare(a.updated));
  }, [memories, q, type]);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border p-3">
        <Input placeholder="Filter by title, id or tag" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
        <Select value={type} onChange={(v) => setType(v as MemoryType | "")} options={[{ value: "", label: "all types" }, ...MEMORY_TYPES.map((t) => ({ value: t, label: t }))]} />
        <span className="text-2xs text-muted-foreground">{list.length} shown</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <table className="w-full text-[12px]">
          <thead className="sticky top-0 bg-background text-left text-2xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Title</th>
              <th className="font-medium">Type</th>
              <th className="font-medium">Projects</th>
              <th className="font-medium">Agents</th>
              <th className="pr-3 font-medium">Updated</th>
            </tr>
          </thead>
          <tbody>
            {list.map((m) => (
              <tr key={m.id} className="cursor-pointer border-t border-border hover:bg-accent/50" onClick={() => onOpen(m.id)}>
                <td className="max-w-[420px] px-3 py-1.5">
                  <div className="truncate font-medium">
                    {isPinned(m) && <span className="mr-1 text-2xs text-amber-300">●</span>}
                    {m.title}
                  </div>
                  <div className="truncate font-mono text-2xs text-muted-foreground">{m.id}</div>
                </td>
                <td><TypeChip type={m.type} /></td>
                <td className="text-muted-foreground">{m.projects.join(", ")}</td>
                <td className="font-mono text-2xs text-muted-foreground">{m.agents.join(", ")}</td>
                <td className="pr-3 text-muted-foreground">{rel(m.updated)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.length === 0 && <Empty>No memories match.</Empty>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ ProjectsView + ProjectDeepDive

export function ProjectsView({ memories, onOpen }: { memories: Memory[]; onOpen: (id: string) => void }) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    fetchProjects().then(setProjects).catch(() => setProjects([]));
  }, []);
  const memoryProjects = useMemo(() => {
    const m = new Map<string, number>();
    memories.forEach((x) => x.projects.forEach((p) => m.set(p, (m.get(p) ?? 0) + 1)));
    return m;
  }, [memories]);
  if (open) {
    const p = projects?.find((x) => x.project === open);
    return <ProjectDeepDive name={open} summary={p} memories={memories.filter((m) => m.projects.includes(open))} onBack={() => setOpen(null)} onOpen={onOpen} />;
  }
  const names = [...new Set([...(projects ?? []).map((p) => p.project), ...memoryProjects.keys()])];
  return (
    <div className="h-full overflow-y-auto p-4">
      {projects === null ? (
        <Empty>Loading…</Empty>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {names.map((n) => {
            const p = projects.find((x) => x.project === n);
            return (
              <button key={n} onClick={() => setOpen(n)} className="rounded-lg border border-border bg-card p-3 text-left hover:bg-accent/40">
                <div className="text-[13px] font-semibold">{n}</div>
                <div className="mt-1 text-2xs text-muted-foreground">
                  {p ? `${p.files} files · ${bytes(p.bytes)}` : "not indexed as code"} · {memoryProjects.get(n) ?? 0} memories
                </div>
                {p && (
                  <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-muted">
                    {p.languages.slice(0, 6).map((l, i) => (
                      <div key={l.name} title={`${l.name}: ${l.files}`} style={{ width: `${(l.files / Math.max(1, p.files)) * 100}%`, background: ["#7e95b8", "#9b8f6f", "#6c8b7f", "#8a738a", "#5f7a91", "#b08a5c"][i] }} />
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ProjectDeepDive({ name, summary, memories, onBack, onOpen }: { name: string; summary?: ProjectSummary; memories: Memory[]; onBack: () => void; onOpen: (id: string) => void }) {
  return (
    <div className="h-full overflow-y-auto p-4">
      <Button size="sm" variant="ghost" onClick={onBack}>
        <ArrowLeft /> Projects
      </Button>
      <h2 className="mt-2 text-[16px] font-semibold">{name}</h2>
      <div className="mt-3 grid grid-cols-[260px_1fr] gap-3">
        <Card className="p-3">
          <SectionLabel>Code</SectionLabel>
          {summary ? (
            <>
              <div className="text-[12px]">{summary.files} files · {bytes(summary.bytes)}</div>
              <ul className="mt-2 space-y-0.5 text-[12px]">
                {summary.languages.map((l) => (
                  <li key={l.name} className="flex justify-between">
                    <span>{l.name}</span>
                    <span className="font-mono text-muted-foreground">{l.files}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="text-[12px] text-muted-foreground">Not a configured code project. Add it under [[projects]] in config.toml.</div>
          )}
        </Card>
        <Card className="p-3">
          <SectionLabel>Memories ({memories.length})</SectionLabel>
          <ul className="space-y-0.5">
            {memories.map((m) => (
              <li key={m.id}>
                <button className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[12px] hover:bg-accent" onClick={() => onOpen(m.id)}>
                  <span className="size-1.5 rounded-full" style={{ background: typeFill(m.type) }} />
                  <span className="flex-1 truncate">{m.title}</span>
                  <span className="text-2xs text-muted-foreground">{rel(m.updated)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ CodeView

export function CodeView() {
  const [q, setQ] = useState("");
  const [project, setProject] = useState("");
  const [projects, setProjects] = useState<string[]>([]);
  const [hits, setHits] = useState<CodeHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetchProjects().then((p) => setProjects(p.map((x) => x.project))).catch(() => {});
  }, []);
  const run = async () => {
    if (!q.trim()) return;
    setBusy(true);
    try {
      setHits(await codeSearch(q.trim(), project || undefined, 40));
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border p-3">
        <Input placeholder="Search code across indexed projects (exact phrase)" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void run()} className="max-w-lg" />
        <Select value={project} onChange={setProject} options={[{ value: "", label: "all projects" }, ...projects.map((p) => ({ value: p, label: p }))]} />
        <Button onClick={run} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Search />} Search
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {hits === null && <Empty>Search the code of every project in config.toml.</Empty>}
        {hits?.length === 0 && <Empty>No matches.</Empty>}
        {hits?.map((h) => (
          <Card key={`${h.path}:${h.line_start}`} className="overflow-hidden">
            <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 font-mono text-[11px]">
              <span className="text-muted-foreground">{h.project}</span>
              <span className="truncate">{h.path}</span>
              <span className="ml-auto text-muted-foreground">L{h.line_start}–{h.line_end}</span>
            </div>
            <pre className="max-h-64 overflow-auto p-3 font-mono text-[11px] leading-relaxed">
              {h.body.split("\n").map((l, i) => (
                <div key={i} className={cn(q && l.toLowerCase().includes(q.toLowerCase()) && "bg-amber-500/10")}>
                  <span className="mr-3 inline-block w-8 select-none text-right text-muted-foreground">{h.line_start + i}</span>
                  {l}
                </div>
              ))}
            </pre>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ AgentsView

const TOOL_TABLE: [string, string][] = [
  ["memory_search / memory_read / memory_recent / memory_list", "find and read memories"],
  ["memory_write", "create or overwrite (expected_updated for conflict checks)"],
  ["memory_link", "typed edge, persisted into the src file"],
  ["memory_system_context", "pinned memories as one bundle — call first"],
  ["memory_context", "token-budgeted bundle for a query"],
  ["code_search / code_read / code_projects", "full-text over indexed code"],
  ["graph_overview / graph_neighbors / graph_path / graph_hubs", "navigate connections"],
  ["task_create / claim / complete / block / list / handoff", "orchestration"],
  ["agent_register / agent_done / agent_list", "sub-agent identity"],
  ["template_list / template_apply", "ADR, post-mortem, task, research, session summary"],
  ["audit_query", "what changed recently and by whom"],
];

const CLIENTS = [
  { name: "claude-code", label: "Claude Code", file: "~/.claude.json → mcpServers.aimemory" },
  { name: "codex", label: "Codex CLI", file: "~/.codex/config.toml → [mcp_servers.aimemory]" },
  { name: "cursor", label: "Cursor", file: "~/.cursor/mcp.json → mcpServers.aimemory" },
];

export function AgentsView({ memories }: { memories: Memory[] }) {
  const [presence, setPresence] = useState<Awaited<ReturnType<typeof fetchPresence>> | null>(null);
  const [events, setEvents] = useState<AimEvent[]>([]);
  useEffect(() => {
    const load = () => {
      fetchPresence().then(setPresence).catch(() => {});
      fetchEvents(40).then((e) => setEvents(e.reverse())).catch(() => {});
    };
    load();
    const t = window.setInterval(load, 5000);
    return () => window.clearInterval(t);
  }, []);
  const agents = useMemo(() => {
    const m = new Map<string, Memory[]>();
    memories.forEach((x) => x.agents.forEach((a) => m.set(a, [...(m.get(a) ?? []), x])));
    return [...m.entries()].map(([name, ms]) => ({
      name,
      writes: ms.length,
      types: [...new Set(ms.map((x) => x.type))],
      last: ms.map((x) => x.updated).sort().pop() ?? "",
      live: presence?.agents.find((p) => p.name === name)?.live ?? false,
    })).sort((a, b) => b.last.localeCompare(a.last));
  }, [memories, presence]);
  return (
    <div className="h-full space-y-4 overflow-y-auto p-4">
      <div>
        <SectionLabel>MCP client wiring</SectionLabel>
        <div className="grid grid-cols-3 gap-3">
          {CLIENTS.map((c) => {
            const installed = presence?.agents.find((p) => p.name === c.name)?.installed;
            return (
              <Card key={c.name} className="p-3">
                <div className="flex items-center gap-2 text-[13px] font-semibold">
                  <span className={cn("size-1.5 rounded-full", installed ? "bg-emerald-400" : "bg-zinc-600")} />
                  {c.label}
                </div>
                <div className="mt-1 font-mono text-2xs text-muted-foreground">{c.file}</div>
                <div className="mt-2 text-[12px]">{installed ? "Registered" : <>Not registered — run <code className="font-mono">aim install-clients</code></>}</div>
              </Card>
            );
          })}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Card className="p-3">
          <SectionLabel>Active agents</SectionLabel>
          {agents.length === 0 && <Empty>No agent has written a memory yet.</Empty>}
          <ul className="space-y-1">
            {agents.map((a) => (
              <li key={a.name} className="flex items-center gap-2 text-[12px]">
                <span className={cn("size-1.5 rounded-full", a.live ? "bg-emerald-400" : "bg-zinc-600")} />
                <span className="flex-1 font-mono">{a.name}</span>
                <span className="flex gap-0.5">
                  {a.types.map((t) => <span key={t} className="size-1.5 rounded-full" style={{ background: typeFill(t) }} />)}
                </span>
                <span className="w-16 text-right tabular-nums text-muted-foreground">{a.writes} writes</span>
                <span className="w-24 text-right text-2xs text-muted-foreground">{rel(a.last)}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-3">
          <SectionLabel>Recent events</SectionLabel>
          <ul className="max-h-72 space-y-0.5 overflow-y-auto font-mono text-[11px]">
            {events.map((e, i) => (
              <li key={i} className="flex gap-2">
                <span className="w-16 shrink-0 text-muted-foreground">{e.ts ? new Date(e.ts * 1000).toLocaleTimeString() : ""}</span>
                <span className="w-32 shrink-0">{e.type === "memory_accessed" ? `${e.agent} ${e.op}` : e.type}</span>
                <span className="truncate text-muted-foreground">{e.id ?? e.ids?.join(", ") ?? e.path}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <Card className="p-3">
        <SectionLabel>MCP tools exposed (27)</SectionLabel>
        <table className="w-full text-[12px]">
          <tbody>
            {TOOL_TABLE.map(([t, d]) => (
              <tr key={t} className="border-t border-border first:border-0">
                <td className="py-1.5 pr-4 font-mono text-[11px]">{t}</td>
                <td className="text-muted-foreground">{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ BenchmarkView

interface Run {
  at: number;
  name: string;
  runner: "claude" | "codex";
  prompt: string;
  elapsed: number;
  output: string;
  ok: boolean;
}

const PRESETS: { name: string; prompt: string }[] = [
  { name: "Lava lamp", prompt: "Write a single self-contained HTML file with an animated lava lamp made of blobby shapes. Output only the HTML in one ```html block." },
  { name: "Pong", prompt: "Write a single self-contained HTML file with a playable Pong game against a simple AI paddle. Output only the HTML in one ```html block." },
  { name: "Clock", prompt: "Write a single self-contained HTML file showing an elegant animated analog clock. Output only the HTML in one ```html block." },
  { name: "3D cube", prompt: "Write a single self-contained HTML file with a rotating shaded 3D cube drawn on a canvas without libraries. Output only the HTML in one ```html block." },
];

const RUNS_KEY = "boltramemory.benchmark.runs";

function loadRuns(): Run[] {
  try {
    return JSON.parse(localStorage.getItem(RUNS_KEY) || "[]");
  } catch {
    return [];
  }
}

function extractHtml(out: string): string | null {
  const m = out.match(/```html\s*\n([\s\S]*?)```/i) || out.match(/(<!doctype html[\s\S]*<\/html>)/i);
  return m ? m[1] : null;
}

export function BenchmarkView() {
  const [prompt, setPrompt] = useState(PRESETS[0].prompt);
  const [name, setName] = useState(PRESETS[0].name);
  const [runner, setRunner] = useState<"claude" | "codex">("claude");
  const [busy, setBusy] = useState(false);
  const [runs, setRuns] = useState<Run[]>(loadRuns);
  const [sel, setSel] = useState(0);
  const [mode, setMode] = useState<"preview" | "code" | "raw">("preview");
  const run = runs[sel];

  const go = async () => {
    setBusy(true);
    try {
      const r = await runBenchmark(prompt, runner, name);
      const entry: Run = { at: Date.now(), name, runner, prompt, elapsed: r.elapsed_s, output: r.output, ok: r.ok };
      const next = [entry, ...runs].slice(0, 20);
      setRuns(next);
      setSel(0);
      try {
        localStorage.setItem(RUNS_KEY, JSON.stringify(next));
      } catch {
        /* quota */
      }
      toast(`${runner} finished in ${r.elapsed_s}s`, r.ok ? "ok" : "err");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  const html = run ? extractHtml(run.output) : null;
  return (
    <div className="grid h-full grid-cols-[340px_1fr]">
      <div className="space-y-3 overflow-y-auto border-r border-border p-3">
        <div className="flex flex-wrap gap-1">
          {PRESETS.map((p) => (
            <Button key={p.name} size="sm" variant={name === p.name ? "outline" : "ghost"} onClick={() => { setPrompt(p.prompt); setName(p.name); }}>
              {p.name}
            </Button>
          ))}
        </div>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Run name" />
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={7} className="w-full rounded-md border border-input bg-transparent p-2 text-[12px]" />
        <div className="flex gap-2">
          <Select value={runner} onChange={(v) => setRunner(v as "claude" | "codex")} options={[{ value: "claude", label: "claude" }, { value: "codex", label: "codex" }]} />
          <Button variant="default" className="flex-1" onClick={go} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Play />} {busy ? "Running…" : "Run"}
          </Button>
        </div>
        <SectionLabel>Last runs</SectionLabel>
        <ul className="space-y-0.5">
          {runs.map((r, i) => (
            <li key={r.at}>
              <button onClick={() => setSel(i)} className={cn("flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[12px] hover:bg-accent", i === sel && "bg-accent")}>
                <span className={cn("size-1.5 rounded-full", r.ok ? "bg-emerald-400" : "bg-rose-400")} />
                <span className="flex-1 truncate">{r.name}</span>
                <span className="font-mono text-2xs text-muted-foreground">{r.runner} · {r.elapsed}s</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex min-h-0 flex-col">
        <div className="flex gap-1 border-b border-border p-2">
          {(["preview", "code", "raw"] as const).map((m) => (
            <Button key={m} size="sm" variant={mode === m ? "outline" : "ghost"} onClick={() => setMode(m)}>
              {m}
            </Button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {!run && <Empty>Run a prompt through claude or codex to compare outputs. Each run is also saved as a conversation memory.</Empty>}
          {run && mode === "preview" && (html ? <iframe title="preview" sandbox="allow-scripts" srcDoc={html} className="h-full w-full bg-white" /> : <Empty>No HTML block in the output.</Empty>)}
          {run && mode === "code" && <pre className="whitespace-pre-wrap p-3 font-mono text-[11px]">{html ?? "(no HTML block)"}</pre>}
          {run && mode === "raw" && <pre className="whitespace-pre-wrap p-3 font-mono text-[11px]">{run.output}</pre>}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ HelpView

export function HelpView() {
  const block = (title: string, children: ReactNode) => (
    <Card className="p-4">
      <div className="mb-2 text-[13px] font-semibold">{title}</div>
      <div className="space-y-2 text-[12px] leading-relaxed text-muted-foreground">{children}</div>
    </Card>
  );
  const code = (s: string) => <pre className="whitespace-pre-wrap rounded-md bg-muted p-2 font-mono text-[11px] text-foreground">{s}</pre>;
  return (
    <div className="mx-auto h-full max-w-3xl space-y-3 overflow-y-auto p-4">
      {block("What is wired", <>
        <p>One MCP server, <span className="font-mono text-foreground">aimemory</span>, launched over stdio by each client as <span className="font-mono">python -m server.mcp_server</span> with <span className="font-mono">PYTHONPATH</span> set to the AIMemory folder. It exposes 27 tools. This UI talks to the same SQLite index through the API on <span className="font-mono">127.0.0.1:5470</span>; the watcher keeps both in sync with the markdown files.</p>
      </>)}
      {block("Prompts to paste into each client", <>
        <p>Claude Code, Codex or Cursor — after restarting the client:</p>
        {code("Call memory_system_context, then memory_context(\"what are we working on\"). Summarise what you now know in three lines.")}
        {code("Write a decision memory: we use SQLite FTS5 for memory search. Then link it to aimemory-overview with kind part_of.")}
        {code("Create a task \"Try the hub from Codex\" assigned to codex, then list open tasks.")}
      </>)}
      {block("How to verify", <>
        <p>Watch this page while an agent writes: the node appears with a ripple and the status bar shows the event. The galaxy at <span className="font-mono">/galaxy.html</span> lights up the stars an agent reads. <span className="font-mono">aim recent</span> prints the newest memories in a terminal.</p>
      </>)}
      {block("Troubleshooting", <>
        <ul className="list-disc space-y-1 pl-4">
          <li>Status bar says Offline: run <span className="font-mono">aim start</span> (watcher + API) and check <span className="font-mono">.aim/api.log</span>.</li>
          <li>Tools missing in a client: run <span className="font-mono">aim install-clients</span> and restart the client.</li>
          <li>Hand edits not showing: the watcher must be running; <span className="font-mono">aim index</span> rebuilds everything.</li>
          <li>Clients without MCP can use the CLI: <span className="font-mono">aim search</span>, <span className="font-mono">aim write</span>, <span className="font-mono">aim recent</span>.</li>
        </ul>
      </>)}
    </div>
  );
}

// ------------------------------------------------------------------ SettingsView

export function SettingsView() {
  const [theme, setTheme] = useState<Theme>(getTheme);
  const [syncing, setSyncing] = useState(false);
  const [syncOut, setSyncOut] = useState("");
  return (
    <div className="mx-auto h-full max-w-3xl space-y-3 overflow-y-auto p-4">
      <Card className="p-4">
        <SectionLabel>Appearance</SectionLabel>
        <div className="grid grid-cols-4 gap-2">
          {THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setTheme(t.id);
                applyTheme(t.id);
              }}
              className={cn("rounded-md border border-border p-2 text-left hover:bg-accent", theme === t.id && "border-ring")}
            >
              <div className="flex h-8 overflow-hidden rounded">
                {t.swatch.map((c) => <div key={c} className="flex-1" style={{ background: c }} />)}
              </div>
              <div className="mt-1.5 text-[12px] font-medium">{t.label}</div>
              <div className="text-2xs text-muted-foreground">{t.note}</div>
            </button>
          ))}
        </div>
      </Card>
      <Card className="p-4">
        <SectionLabel>System</SectionLabel>
        <dl className="grid grid-cols-[140px_1fr] gap-y-1 text-[12px]">
          <dt className="text-muted-foreground">Memory store</dt><dd className="font-mono">~/Documents/AIMemory/memories</dd>
          <dt className="text-muted-foreground">SQLite index</dt><dd className="font-mono">~/Documents/AIMemory/index</dd>
          <dt className="text-muted-foreground">Config</dt><dd className="font-mono">~/Documents/AIMemory/config.toml</dd>
          <dt className="text-muted-foreground">MCP server</dt><dd className="font-mono">stdio · server.mcp_server</dd>
        </dl>
      </Card>
      <Card className="p-4">
        <SectionLabel>Sync</SectionLabel>
        <p className="text-[12px] text-muted-foreground">
          The AIMemory folder is a git repo. <span className="font-mono">aim sync</span> commits, then pulls and pushes when a remote is set. On a new machine: clone, then <span className="font-mono">bash scripts/install.sh</span>.
        </p>
        <Button
          className="mt-2"
          disabled={syncing}
          onClick={async () => {
            setSyncing(true);
            try {
              const r = await runSync();
              setSyncOut((r.stdout + "\n" + r.stderr).trim());
              toast(r.ok ? "Synced" : "Sync failed", r.ok ? "ok" : "err");
            } catch (e) {
              toast((e as Error).message, "err");
            } finally {
              setSyncing(false);
            }
          }}
        >
          {syncing ? <Loader2 className="animate-spin" /> : <RefreshCw />} Run aim sync
        </Button>
        {syncOut && <pre className="mt-2 max-h-40 overflow-auto rounded bg-muted p-2 font-mono text-[11px]">{syncOut}</pre>}
      </Card>
      <Card className="p-4">
        <SectionLabel>Data</SectionLabel>
        <Button asChild>
          <a href="/api/export.zip">
            <Download /> Download .zip
          </a>
        </Button>
      </Card>
      <Card className="p-4">
        <SectionLabel>About</SectionLabel>
        <div className="text-[12px]">BoltraMemory · Version 0.1.0</div>
      </Card>
    </div>
  );
}
