import { useEffect, useRef, useState } from "react";
import { Loader2, MessageCircleQuestion, Search } from "lucide-react";
import type { Memory, MemoryType } from "@/types";
import { MEMORY_TYPES } from "@/types";
import { ask, createMemory, searchMemory } from "@/lib/api";
import { TEMPLATES } from "@/lib/templates";
import { toast } from "@/lib/toast";
import { cn, splitList } from "@/lib/utils";
import { typeFill } from "@/lib/colors";
import { Markdown } from "./Markdown";
import { Button, Dialog, DialogContent, Input, Select, Textarea } from "./ui";

const typeOptions = MEMORY_TYPES.map((t) => ({ value: t, label: t }));

// ------------------------------------------------------------------ CommandPalette (⌘K)

export function CommandPalette({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Memory[]>([]);
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const t = window.setTimeout(() => {
      searchMemory(q, undefined, 30)
        .then((r) => {
          setHits(r);
          setIdx(0);
        })
        .catch(() => setHits([]))
        .finally(() => setLoading(false));
    }, 140);
    return () => window.clearTimeout(t);
  }, [q, open]);

  useEffect(() => {
    if (open) setQ("");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Search memories" className="max-w-xl p-0 [&>div:first-child]:hidden">
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="size-3.5 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search memories…"
            className="h-10 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIdx((i) => Math.min(i + 1, hits.length - 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setIdx((i) => Math.max(i - 1, 0));
              }
              if (e.key === "Enter" && hits[idx]) {
                onPick(hits[idx].id);
                onClose();
              }
            }}
          />
          {loading && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-1">
          {hits.length === 0 && !loading && <div className="p-4 text-center text-[12px] text-muted-foreground">No matches</div>}
          {hits.map((h, i) => (
            <button
              key={h.id}
              onMouseEnter={() => setIdx(i)}
              onClick={() => {
                onPick(h.id);
                onClose();
              }}
              className={cn("flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left", i === idx && "bg-accent")}
            >
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full" style={{ background: typeFill(h.type) }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-medium">{h.title}</span>
                <span className="block truncate text-2xs text-muted-foreground">
                  {h.body.replace(/\s+/g, " ").slice(0, 120)}
                </span>
              </span>
              <span className="font-mono text-2xs text-muted-foreground">{h.type}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-3 border-t border-border px-3 py-1.5 text-2xs text-muted-foreground">
          <span><kbd>↑↓</kbd> move</span>
          <span><kbd>⏎</kbd> open</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ NewMemoryDialog (N)

export function NewMemoryDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [type, setType] = useState<MemoryType>("decision");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [projects, setProjects] = useState("");
  const [tags, setTags] = useState("");
  const [confidence, setConfidence] = useState("medium");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle("");
      setBody("");
      setTags("");
    }
  }, [open]);

  const submit = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const r = await createMemory({ type, title: title.trim(), body, projects: splitList(projects), tags: splitList(tags), confidence });
      toast(`Created ${r.id}`, "ok");
      onCreated(r.id);
      onClose();
    } catch (e) {
      toast(`Create failed: ${(e as Error).message}`, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="New memory" className="max-w-xl">
        <div className="mb-3 flex flex-wrap gap-1">
          {TEMPLATES.map((t) => (
            <Button
              key={t.id}
              size="sm"
              variant="outline"
              onClick={() => {
                setType(t.type);
                setTitle(t.title());
                setBody(t.body);
                setTags(t.tags.join(", "));
              }}
            >
              {t.label}
            </Button>
          ))}
        </div>
        <div className="space-y-2">
          <div className="flex gap-2">
            <Select value={type} onChange={(v) => setType(v as MemoryType)} options={typeOptions} />
            <Input autoFocus placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <Textarea
            rows={10}
            placeholder="Body (markdown). Use [[memory-id]] to reference another memory."
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="font-mono"
            onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && void submit()}
          />
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
            <Input placeholder="projects (comma)" value={projects} onChange={(e) => setProjects(e.target.value)} />
            <Input placeholder="tags (comma)" value={tags} onChange={(e) => setTags(e.target.value)} />
            <Select
              value={confidence}
              onChange={setConfidence}
              options={["low", "medium", "high"].map((v) => ({ value: v, label: v }))}
            />
          </div>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="default" disabled={busy || !title.trim()} onClick={submit}>
            Create
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ QuickCapture (⌥M)

export function QuickCapture({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [text, setText] = useState("");
  const [type, setType] = useState<MemoryType>("decision");
  useEffect(() => {
    if (open) setText("");
  }, [open]);
  const save = async () => {
    const t = text.trim();
    if (!t) return;
    try {
      const r = await createMemory({ type, title: t.length > 80 ? t.slice(0, 77) + "…" : t, body: t });
      toast(`Captured ${r.id}`, "ok");
      onClose();
    } catch (e) {
      toast(`Capture failed: ${(e as Error).message}`, "err");
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Quick capture">
        <div className="flex gap-2">
          <Select value={type} onChange={(v) => setType(v as MemoryType)} options={typeOptions} />
          <Input
            autoFocus
            placeholder="One line worth remembering"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void save()}
          />
        </div>
        <div className="mt-2 text-2xs text-muted-foreground">
          <kbd>⏎</kbd> save · <kbd>esc</kbd> close
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ AskDialog

export function AskDialog({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Awaited<ReturnType<typeof ask>> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const run = async () => {
    if (!q.trim()) return;
    setBusy(true);
    setErr(null);
    setRes(null);
    try {
      setRes(await ask(q.trim()));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const chip = (c: { id: string; title: string; type: string }, cited: boolean) => (
    <button
      key={c.id}
      onClick={() => {
        onPick(c.id);
        onClose();
      }}
      className={cn(
        "flex max-w-full items-center gap-1 truncate rounded border px-1.5 py-0.5 text-2xs hover:bg-accent",
        cited ? "border-ring" : "border-border text-muted-foreground",
      )}
    >
      <span className="size-1.5 rounded-full" style={{ background: typeFill(c.type) }} />
      {c.title}
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Ask your memory" className="max-w-xl">
        <div className="flex gap-2">
          <Input
            ref={input}
            autoFocus
            placeholder="What did we decide about…?"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void run()}
          />
          <Button variant="default" onClick={run} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <MessageCircleQuestion />}
            Ask
          </Button>
        </div>
        {busy && <div className="mt-3 text-[12px] text-muted-foreground">Reading the relevant memories…</div>}
        {err && <div className="mt-3 text-[12px] text-red-300">{err}</div>}
        {res && (
          <div className="mt-3 space-y-3">
            <div className="rounded-md border border-border bg-muted/40 p-3">
              <Markdown body={res.answer.replace(/\[([a-z0-9][a-z0-9-]*)\]/g, "[[$1]]")} onNavigate={(id) => { onPick(id); onClose(); }} />
            </div>
            {res.cited.length > 0 && (
              <div>
                <div className="mb-1 text-2xs uppercase tracking-wider text-muted-foreground">Cited</div>
                <div className="flex flex-wrap gap-1">
                  {res.context.filter((c) => res.cited.includes(c.id)).map((c) => chip(c, true))}
                </div>
              </div>
            )}
            <div>
              <div className="mb-1 text-2xs uppercase tracking-wider text-muted-foreground">Context ({res.context.length})</div>
              <div className="flex flex-wrap gap-1">{res.context.filter((c) => !res.cited.includes(c.id)).map((c) => chip(c, false))}</div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ ShortcutsOverlay (?)

const SHORTCUTS: [string, string][] = [
  ["⌘K / Ctrl-K", "Search"],
  ["?", "This overlay"],
  ["G", "Graph"],
  ["M", "Memories"],
  ["T", "Tasks"],
  ["I", "Insights"],
  ["N", "New memory"],
  ["⌥M", "Quick capture"],
  ["R", "Reset selection, drill-in and menus"],
  ["Esc", "Deselect"],
  ["L (hold) + drag", "Drag a node onto another to link"],
  ["⌘⏎", "Save body edit"],
];

export function ShortcutsOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Keyboard shortcuts">
        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12px]">
          {SHORTCUTS.map(([k, v]) => (
            <div key={k} className="contents">
              <kbd className="justify-self-start">{k}</kbd>
              <span className="text-muted-foreground">{v}</span>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ Onboarding

export function Onboarding({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Welcome to BoltraMemory">
        <div className="space-y-2 text-[12px] leading-relaxed text-muted-foreground">
          <p>
            One shared memory for every AI tool. Claude Code, Codex and Cursor read and write it through the
            <span className="font-mono text-foreground"> aimemory </span>MCP server; this page shows the result live.
          </p>
          <p>
            Each dot is a markdown file in <span className="font-mono text-foreground">memories/</span>. Lines are links
            agents (or you) made between them. Pin a memory to make it a standing rule every agent loads first.
          </p>
          <ul className="list-disc space-y-0.5 pl-4">
            <li>
              <kbd>⌘K</kbd> search, <kbd>N</kbd> new memory, <kbd>⌥M</kbd> quick capture
            </li>
            <li>Right-click a node to link, pin, drill in or delete</li>
            <li>Hold <kbd>L</kbd> and drag one node onto another to link them</li>
          </ul>
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="default" onClick={onClose}>
            Got it
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

