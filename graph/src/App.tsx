import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AimEvent, EdgeKind, GraphData, GraphSettings, Memory, MemoryType, View } from "@/types";
import { DEFAULT_SETTINGS, MEMORY_TYPES } from "@/types";
import { deleteMemory, fetchGraph, linkMemories, openLiveUpdates, runDemo, updateMemory } from "@/lib/api";
import { toast } from "@/lib/toast";
import { copy, isPinned, isTyping } from "@/lib/utils";
import { LeftRail, StatusBar, Toasts, TopBar } from "@/components/Chrome";
import { GraphView, type FG, type GNode } from "@/components/GraphView";
import { GraphControls, MiniMap, TypeLegend } from "@/components/GraphOverlays";
import { Sidebar } from "@/components/Sidebar";
import { LinkPicker, NodeContextMenu } from "@/components/NodeContextMenu";
import { AskDialog, CommandPalette, NewMemoryDialog, Onboarding, QuickCapture, ShortcutsOverlay } from "@/components/Dialogs";
import { TasksView } from "@/components/TasksView";
import { InsightsView } from "@/components/InsightsView";
import { AgentsView, BenchmarkView, CodeView, HelpView, MemoriesView, ProjectsView, SettingsView } from "@/components/Views";
import { Empty, TooltipProvider } from "@/components/ui";

const SETTINGS_KEY = "aim.graphSettings";
const ONBOARDED_KEY = "boltramemory.onboarded";

function loadSettings(): GraphSettings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function describe(e: AimEvent, byId: Map<string, Memory>): string {
  const title = (id?: string) => (id ? byId.get(id)?.title ?? id : "");
  switch (e.type) {
    case "memory_changed":
      return `changed ${title(e.id)}`;
    case "memory_deleted":
      return `deleted ${e.id}`;
    case "memory_accessed":
      return `${e.agent} ${e.op}${e.query ? ` “${e.query}”` : ""} · ${e.ids?.length ?? 0} memories`;
    case "code_changed":
      return `code changed in ${e.project}`;
    default:
      return e.type;
  }
}

export default function App() {
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<View>("graph");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTypes, setActiveTypes] = useState<Set<MemoryType>>(new Set(MEMORY_TYPES));
  const [settings, setSettingsState] = useState<GraphSettings>(loadSettings);
  const [drillId, setDrillId] = useState<string | null>(null);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [palette, setPalette] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [quick, setQuick] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const [onboarding, setOnboarding] = useState(() => {
    try {
      return !localStorage.getItem(ONBOARDED_KEY);
    } catch {
      return false;
    }
  });
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<{ text: string; at: number } | null>(null);
  const [, setChangeToken] = useState(0);
  const ripples = useRef(new Map<string, number>());
  const fgRef = useRef<FG>(null);
  const nodesById = useRef(new Map<string, GNode>());
  const byIdRef = useRef(new Map<string, Memory>());

  const setSettings = (s: GraphSettings) => {
    setSettingsState(s);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch {
      /* private mode */
    }
  };

  const load = useCallback(async () => {
    try {
      setGraph(await fetchGraph());
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const byId = useMemo(() => new Map((graph?.nodes ?? []).map((m) => [m.id, m])), [graph]);
  byIdRef.current = byId;

  useEffect(
    () =>
      openLiveUpdates(
        (e) => {
          if (e.type === "hello") return;
          setLastEvent({ text: describe(e, byIdRef.current), at: Date.now() });
          if (e.type === "memory_changed" || e.type === "memory_deleted") {
            if (e.id && e.type === "memory_changed") ripples.current.set(e.id, Date.now());
            setChangeToken((n) => n + 1);
            void load();
          } else if (e.type === "memory_accessed") {
            e.ids?.forEach((id) => ripples.current.set(id, Date.now()));
          }
        },
        setConnected,
      ),
    [load],
  );

  const nodes = graph?.nodes ?? [];
  const edges = graph?.edges ?? [];

  const degree = useMemo(() => {
    const d = new Map<string, number>();
    edges.forEach((e) => {
      d.set(e.src, (d.get(e.src) ?? 0) + 1);
      d.set(e.dst, (d.get(e.dst) ?? 0) + 1);
    });
    return d;
  }, [edges]);

  const visible = useMemo(() => {
    let ms = nodes.filter((m) => activeTypes.has(m.type));
    if (drillId) {
      const keep = new Set([drillId]);
      edges.forEach((e) => {
        if (e.src === drillId) keep.add(e.dst);
        if (e.dst === drillId) keep.add(e.src);
      });
      ms = nodes.filter((m) => keep.has(m.id));
    }
    if (settings.showOnlyConnected) ms = ms.filter((m) => (degree.get(m.id) ?? 0) > 0);
    const ids = new Set(ms.map((m) => m.id));
    return { memories: ms, edges: edges.filter((e) => ids.has(e.src) && ids.has(e.dst)) };
  }, [nodes, edges, activeTypes, drillId, settings.showOnlyConnected, degree]);

  const latestId = useMemo(() => nodes.reduce<Memory | null>((a, m) => (!a || m.updated > a.updated ? m : a), null)?.id, [nodes]);
  const selected = selectedId ? byId.get(selectedId) ?? null : null;
  const tasks = useMemo(() => nodes.filter((m) => m.type === "task"), [nodes]);

  const focus = (id: string) => {
    setSelectedId(id);
    setView("graph");
    window.setTimeout(() => {
      const n = nodesById.current.get(id);
      if (n && n.x !== undefined && fgRef.current) {
        fgRef.current.centerAt(n.x, n.y, 600);
        fgRef.current.zoom(Math.max(fgRef.current.zoom(), 1.6), 600);
      }
    }, 60);
  };

  const remove = async (id: string) => {
    if (!window.confirm("Delete this memory? The .md file will be removed.")) return;
    try {
      await deleteMemory(id);
      if (selectedId === id) setSelectedId(null);
      toast("Deleted", "ok");
      void load();
    } catch (e) {
      toast(`Delete failed: ${(e as Error).message}`, "err");
    }
  };

  const link = async (src: string, dst: string, kind: EdgeKind = "mentions") => {
    try {
      await linkMemories(src, dst, kind);
      toast(`Linked ${src} → ${dst} (${kind})`, "ok");
      void load();
    } catch (e) {
      toast(`Link failed: ${(e as Error).message}`, "err");
    }
  };

  const togglePin = async (m: Memory) => {
    const tags = isPinned(m) ? m.tags.filter((t) => t !== "pinned:true" && t !== "pinned") : [...m.tags, "pinned:true"];
    try {
      await updateMemory(m.id, { tags });
      toast(isPinned(m) ? "Unpinned" : "Pinned — agents load it via memory_system_context", "ok");
      void load();
    } catch (e) {
      toast(`Pin failed: ${(e as Error).message}`, "err");
    }
  };

  const reset = () => {
    setSelectedId(null);
    setDrillId(null);
    setLinkFrom(null);
    setMenu(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette(true);
        return;
      }
      if (e.altKey && e.code === "KeyM") {
        e.preventDefault();
        setQuick(true);
        return;
      }
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector("[role=dialog]")) return;
      const k = e.key;
      if (k === "?") setShortcuts(true);
      else if (k === "g") setView("graph");
      else if (k === "m") setView("memories");
      else if (k === "t") setView("tasks");
      else if (k === "i") setView("insights");
      else if (k === "n") {
        e.preventDefault();
        setNewOpen(true);
      } else if (k === "r") reset();
      else if (k === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggleType = (t: MemoryType) =>
    setActiveTypes((s) => {
      const n = new Set(s);
      if (n.has(t)) n.delete(t);
      else n.add(t);
      return n;
    });

  const menuMem = menu ? byId.get(menu.id) : undefined;
  const linkMem = linkFrom ? byId.get(linkFrom) : undefined;

  let content: ReactNode;
  if (!graph) {
    content = loadError ? (
      <Empty>
        Can’t reach the API ({loadError}). Start it with <span className="font-mono">aim start</span>.
      </Empty>
    ) : (
      <Empty>Loading memories…</Empty>
    );
  } else if (view === "graph") {
    content = (
      <>
        <GraphView
          memories={visible.memories}
          edges={visible.edges}
          degree={degree}
          settings={settings}
          selectedId={selectedId}
          latestId={latestId}
          ripples={ripples}
          fgRef={fgRef}
          nodesById={nodesById}
          onSelect={setSelectedId}
          onContextMenu={(id, x, y) => setMenu({ id, x, y })}
          onLink={(s, d) => void link(s, d, "mentions")}
        />
        {nodes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="text-center text-[12px] text-muted-foreground">
              No memories yet. Press <kbd>N</kbd> to write one, or let an agent call <span className="font-mono">memory_write</span>.
            </div>
          </div>
        )}
        <GraphControls settings={settings} onChange={setSettings} />
        <TypeLegend nodes={nodes} active={activeTypes} onToggle={toggleType} />
        <MiniMap fgRef={fgRef} nodesById={nodesById} nodes={visible.memories} />
      </>
    );
  } else if (view === "memories") content = <MemoriesView memories={nodes} onOpen={focus} />;
  else if (view === "tasks") content = <TasksView tasks={tasks} onOpen={focus} />;
  else if (view === "insights") content = <InsightsView memories={nodes} onOpen={focus} />;
  else if (view === "benchmark") content = <BenchmarkView />;
  else if (view === "projects") content = <ProjectsView memories={nodes} onOpen={focus} />;
  else if (view === "code") content = <CodeView />;
  else if (view === "agents") content = <AgentsView memories={nodes} />;
  else if (view === "help") content = <HelpView />;
  else content = <SettingsView />;

  return (
    <TooltipProvider>
      <div className="flex h-full">
        <LeftRail view={view} onView={setView} memoryCount={nodes.length} edgeCount={edges.length} connected={connected} />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar
            view={view}
            activeTypes={activeTypes}
            onToggleType={toggleType}
            onSetTypes={setActiveTypes}
            settings={settings}
            onApplyView={(v) => {
              setActiveTypes(new Set(v.activeTypes));
              setSettings({ ...DEFAULT_SETTINGS, ...v.settings });
            }}
            onSearch={() => setPalette(true)}
            onAsk={() => setAskOpen(true)}
            onNew={() => setNewOpen(true)}
            onDemo={async () => {
              try {
                await runDemo();
                toast("Demo started — watch the graph", "info");
                setView("graph");
              } catch (e) {
                toast((e as Error).message, "err");
              }
            }}
            drillTitle={drillId ? byId.get(drillId)?.title : undefined}
            onExitDrill={() => setDrillId(null)}
          />
          <div className="flex min-h-0 flex-1">
            <main className="graph-host relative min-w-0 flex-1 overflow-hidden">{content}</main>
            {view === "graph" && selected && (
              <Sidebar
                memory={selected}
                edges={edges}
                byId={byId}
                onClose={() => setSelectedId(null)}
                onNavigate={focus}
                onLink={setLinkFrom}
                onDelete={remove}
              />
            )}
          </div>
          <StatusBar connected={connected} nodes={nodes.length} edges={edges.length} lastEvent={lastEvent} selectedId={selectedId} />
        </div>
      </div>

      {menu && menuMem && (
        <NodeContextMenu
          memory={menuMem}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onLink={() => setLinkFrom(menuMem.id)}
          onDrill={() => {
            setDrillId(menuMem.id);
            setSelectedId(menuMem.id);
          }}
          onTogglePin={() => void togglePin(menuMem)}
          onCopy={(what) => {
            copy(what === "id" ? menuMem.id : menuMem.path);
            toast(`Copied ${what}`, "ok");
          }}
          onDelete={() => void remove(menuMem.id)}
        />
      )}
      {linkMem && (
        <LinkPicker
          source={linkMem}
          memories={nodes}
          onClose={() => setLinkFrom(null)}
          onLink={(dst, kind) => {
            setLinkFrom(null);
            void link(linkMem.id, dst, kind);
          }}
        />
      )}
      <CommandPalette open={palette} onClose={() => setPalette(false)} onPick={focus} />
      <NewMemoryDialog open={newOpen} onClose={() => setNewOpen(false)} onCreated={(id) => { void load().then(() => focus(id)); }} />
      <QuickCapture open={quick} onClose={() => setQuick(false)} />
      <AskDialog open={askOpen} onClose={() => setAskOpen(false)} onPick={focus} />
      <ShortcutsOverlay open={shortcuts} onClose={() => setShortcuts(false)} />
      <Onboarding
        open={onboarding}
        onClose={() => {
          setOnboarding(false);
          try {
            localStorage.setItem(ONBOARDED_KEY, "1");
          } catch {
            /* private mode */
          }
        }}
      />
      <Toasts />
    </TooltipProvider>
  );
}
