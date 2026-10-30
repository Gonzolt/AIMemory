import React, { useEffect, useRef, useState } from "react";
import {
  Bookmark,
  ChevronDown,
  Code2,
  Cpu,
  FolderGit2,
  Gauge,
  HelpCircle,
  KanbanSquare,
  LineChart,
  ListTree,
  MessageCircleQuestion,
  Network,
  Play,
  Plus,
  Search,
  Settings,
  Trash2,
} from "lucide-react";
import type { GraphSettings, MemoryType, View } from "@/types";
import { MEMORY_TYPES } from "@/types";
import { typeFill } from "@/lib/colors";
import { useToasts } from "@/lib/toast";
import { cn, rel } from "@/lib/utils";
import { Button, Tip } from "./ui";

// ------------------------------------------------------------------ LeftRail

const WORKSPACE: { id: View; label: string; icon: React.ElementType }[] = [
  { id: "graph", label: "Graph", icon: Network },
  { id: "memories", label: "Memories", icon: ListTree },
  { id: "tasks", label: "Tasks", icon: KanbanSquare },
  { id: "insights", label: "Insights", icon: LineChart },
  { id: "benchmark", label: "Benchmark", icon: Gauge },
];
const SOURCES: { id: View; label: string; icon: React.ElementType }[] = [
  { id: "projects", label: "Projects", icon: FolderGit2 },
  { id: "code", label: "Code", icon: Code2 },
  { id: "agents", label: "Agents", icon: Cpu },
];

export const VIEW_LABELS: Record<View, string> = {
  graph: "Graph",
  memories: "Memories",
  tasks: "Tasks",
  insights: "Insights",
  benchmark: "Benchmark",
  projects: "Projects",
  code: "Code",
  agents: "Agents",
  help: "How to test",
  settings: "Settings",
};

export function LeftRail({
  view,
  onView,
  memoryCount,
  edgeCount,
  connected,
}: {
  view: View;
  onView: (v: View) => void;
  memoryCount: number;
  edgeCount: number;
  connected: boolean;
}) {
  const item = (v: { id: View; label: string; icon: React.ElementType }, count?: number) => {
    const Icon = v.icon;
    return (
      <button
        key={v.id}
        onClick={() => onView(v.id)}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground",
          view === v.id && "bg-accent text-foreground",
        )}
      >
        <Icon className="size-3.5" />
        <span className="flex-1 text-left">{v.label}</span>
        {count !== undefined && <span className="font-mono text-2xs">{count}</span>}
      </button>
    );
  };
  return (
    <nav className="flex w-[188px] shrink-0 flex-col border-r border-border bg-card px-2 py-3">
      <div className="mb-4 flex items-center gap-2 px-2">
        <img src="/favicon.svg" alt="" className="size-5" />
        <span className="text-[13px] font-semibold tracking-tight">BoltraMemory</span>
      </div>
      <div className="mb-1 px-2 text-2xs font-medium uppercase tracking-wider text-muted-foreground">Workspace</div>
      <div className="space-y-px">{WORKSPACE.map((v) => item(v, v.id === "memories" ? memoryCount : undefined))}</div>
      <div className="mb-1 mt-4 px-2 text-2xs font-medium uppercase tracking-wider text-muted-foreground">Sources</div>
      <div className="space-y-px">{SOURCES.map((v) => item(v))}</div>
      <div className="flex-1" />
      <div className="mb-2 flex items-center gap-2 px-2 text-2xs text-muted-foreground">
        <span className={cn("size-1.5 rounded-full", connected ? "bg-emerald-400" : "bg-zinc-600")} />
        {connected ? "live" : "offline"} · <span className="font-mono">{edgeCount}</span> edges
      </div>
      <div className="space-y-px">
        {item({ id: "help", label: "Help", icon: HelpCircle })}
        {item({ id: "settings", label: "Settings", icon: Settings })}
      </div>
    </nav>
  );
}

// ------------------------------------------------------------------ SavedViews

export interface SavedView {
  name: string;
  activeTypes: MemoryType[];
  settings: GraphSettings;
}

const SV_KEY = "aim.savedViews";

function loadViews(): SavedView[] {
  try {
    return JSON.parse(localStorage.getItem(SV_KEY) || "[]");
  } catch {
    return [];
  }
}

function SavedViews({ current, onApply }: { current: Omit<SavedView, "name">; onApply: (v: SavedView) => void }) {
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState<SavedView[]>(loadViews);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, []);
  const persist = (v: SavedView[]) => {
    setViews(v);
    try {
      localStorage.setItem(SV_KEY, JSON.stringify(v));
    } catch {
      /* private mode */
    }
  };
  return (
    <div ref={ref} className="relative">
      <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)} title="Saved views">
        <Bookmark />
        Views
      </Button>
      {open && (
        <div className="absolute right-0 top-8 z-40 w-56 rounded-md border border-border bg-card p-1 shadow-xl">
          {views.length === 0 && <div className="px-2 py-1.5 text-2xs text-muted-foreground">No saved views yet.</div>}
          {views.map((v) => (
            <div key={v.name} className="group flex items-center rounded hover:bg-accent">
              <button className="flex-1 px-2 py-1.5 text-left text-[12px]" onClick={() => { onApply(v); setOpen(false); }}>
                {v.name}
              </button>
              <button
                className="px-2 text-muted-foreground opacity-0 hover:text-red-300 group-hover:opacity-100"
                onClick={() => persist(views.filter((x) => x.name !== v.name))}
              >
                <Trash2 className="size-3" />
              </button>
            </div>
          ))}
          <button
            className="mt-1 flex w-full items-center gap-1.5 border-t border-border px-2 py-1.5 text-left text-[12px] text-muted-foreground hover:text-foreground"
            onClick={() => {
              const name = window.prompt("Name this view");
              if (name) persist([...views.filter((x) => x.name !== name), { name, ...current }]);
            }}
          >
            <Plus className="size-3" /> Save current view
          </button>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ TopBar

export function TopBar({
  view,
  activeTypes,
  onToggleType,
  onSetTypes,
  settings,
  onApplyView,
  onSearch,
  onAsk,
  onNew,
  onDemo,
  drillTitle,
  onExitDrill,
}: {
  view: View;
  activeTypes: Set<MemoryType>;
  onToggleType: (t: MemoryType) => void;
  onSetTypes: (t: Set<MemoryType>) => void;
  settings: GraphSettings;
  onApplyView: (v: SavedView) => void;
  onSearch: () => void;
  onAsk: () => void;
  onNew: () => void;
  onDemo: () => void;
  drillTitle?: string;
  onExitDrill: () => void;
}) {
  const [typesOpen, setTypesOpen] = useState(false);
  const [demoConfirm, setDemoConfirm] = useState(false);
  return (
    <header className="flex h-11 min-w-0 shrink-0 items-center gap-2 overflow-hidden border-b border-border bg-card px-3">
      <div className="flex min-w-0 items-center gap-1.5 text-[12px]">
        <span className="text-muted-foreground">BoltraMemory</span>
        <span className="text-muted-foreground">/</span>
        <span className={cn(drillTitle && "cursor-pointer text-muted-foreground hover:text-foreground")} onClick={drillTitle ? onExitDrill : undefined}>
          {VIEW_LABELS[view]}
        </span>
        {drillTitle && (
          <>
            <span className="text-muted-foreground">/</span>
            <span className="max-w-[260px] truncate">{drillTitle}</span>
          </>
        )}
      </div>
      {view === "graph" && (
        <div className="relative">
          <Button size="sm" variant="ghost" onClick={() => setTypesOpen((o) => !o)}>
            Types <span className="font-mono text-muted-foreground">{activeTypes.size}/{MEMORY_TYPES.length}</span>
            <ChevronDown />
          </Button>
          {typesOpen && (
            <div className="absolute left-0 top-8 z-40 w-48 rounded-md border border-border bg-card p-1 shadow-xl" onMouseLeave={() => setTypesOpen(false)}>
              {MEMORY_TYPES.map((t) => (
                <label key={t} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[12px] hover:bg-accent">
                  <input type="checkbox" checked={activeTypes.has(t)} onChange={() => onToggleType(t)} />
                  <span className="size-2 rounded-full" style={{ background: typeFill(t) }} />
                  {t}
                </label>
              ))}
              <div className="mt-1 flex gap-1 border-t border-border pt-1">
                <Button size="sm" variant="ghost" className="flex-1" onClick={() => onSetTypes(new Set(MEMORY_TYPES))}>All</Button>
                <Button size="sm" variant="ghost" className="flex-1" onClick={() => onSetTypes(new Set())}>None</Button>
              </div>
            </div>
          )}
        </div>
      )}
      <div className="flex-1" />
      <button
        onClick={onSearch}
        className="flex h-7 w-56 min-w-[96px] shrink items-center gap-2 rounded-md border border-border px-2 text-[12px] text-muted-foreground hover:bg-accent"
      >
        <Search className="size-3.5" />
        <span className="flex-1 text-left">Search</span>
        <kbd>⌘K</kbd>
      </button>
      <Tip label="Ask a question across your memories" side="bottom">
        <Button size="sm" variant="ghost" onClick={onAsk}>
          <MessageCircleQuestion />
          Ask
        </Button>
      </Tip>
      <Button size="sm" variant="default" onClick={onNew}>
        <Plus />
        New memory
      </Button>
      <SavedViews current={{ activeTypes: [...activeTypes], settings }} onApply={onApplyView} />
      <Button size="sm" variant="ghost" onClick={() => setDemoConfirm(true)} title="Run the scripted live demo">
        <Play />
        Demo
      </Button>
      {demoConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setDemoConfirm(false)}>
          <div className="w-80 rounded-lg border border-border bg-card p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="text-[13px] font-semibold">Run the live demo?</div>
            <p className="mt-1.5 text-[12px] text-muted-foreground">
              Writes four demo memories one by one, links them, replays agent activity, then removes them again. Takes about 20 seconds.
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDemoConfirm(false)}>Cancel</Button>
              <Button variant="default" onClick={() => { setDemoConfirm(false); onDemo(); }}>Run demo</Button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}

// ------------------------------------------------------------------ StatusBar

export function StatusBar({
  connected,
  nodes,
  edges,
  lastEvent,
  selectedId,
}: {
  connected: boolean;
  nodes: number;
  edges: number;
  lastEvent: { text: string; at: number } | null;
  selectedId: string | null;
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 15000);
    return () => window.clearInterval(t);
  }, []);
  return (
    <footer className="flex h-6 shrink-0 items-center gap-4 border-t border-border bg-card px-3 text-2xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className={cn("size-1.5 rounded-full", connected ? "bg-emerald-400" : "bg-zinc-600")} />
        {connected ? "Connected" : "Offline"}
      </span>
      <span className="font-mono">{nodes} nodes · {edges} edges</span>
      {lastEvent && (
        <span className="truncate">
          {lastEvent.text} · {rel(lastEvent.at / 1000)}
        </span>
      )}
      <span className="flex-1" />
      {selectedId && <span className="font-mono">{selectedId}</span>}
    </footer>
  );
}

// ------------------------------------------------------------------ Toasts

export function Toasts() {
  const toasts = useToasts();
  return (
    <div className="pointer-events-none fixed bottom-9 right-4 z-[70] flex flex-col items-end gap-1.5">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "rounded-md border bg-card px-3 py-1.5 text-[12px] shadow-xl animate-in fade-in-0 slide-in-from-bottom-2",
            t.kind === "ok" && "border-emerald-900/70",
            t.kind === "err" && "border-red-900/70 text-red-200",
            t.kind === "info" && "border-border",
          )}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ ErrorBoundary

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full items-center justify-center bg-background p-6">
        <div className="w-full max-w-lg rounded-lg border border-red-900/60 bg-card p-5">
          <div className="text-[13px] font-semibold">BoltraMemory · render error</div>
          <pre className="mt-3 max-h-64 overflow-auto rounded bg-muted p-2 font-mono text-[11px] text-red-200">
            {this.state.error.message}
            {"\n"}
            {this.state.error.stack}
          </pre>
          <Button className="mt-3" variant="default" onClick={() => location.reload()}>
            Reload
          </Button>
        </div>
      </div>
    );
  }
}
