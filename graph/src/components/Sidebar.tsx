import { useEffect, useState } from "react";
import { Copy, Link2, Pencil, Sparkles, Trash2, X } from "lucide-react";
import type { Edge, Memory } from "@/types";
import { getSummary, makeSummary, updateMemory } from "@/lib/api";
import { toast } from "@/lib/toast";
import { copy, rel } from "@/lib/utils";
import { Markdown } from "./Markdown";
import { Button, ScrollArea, SectionLabel, Textarea, TypeChip } from "./ui";
import { typeFill } from "@/lib/colors";

export function Sidebar({
  memory,
  edges,
  byId,
  onClose,
  onNavigate,
  onLink,
  onDelete,
}: {
  memory: Memory;
  edges: Edge[];
  byId: Map<string, Memory>;
  onClose: () => void;
  onNavigate: (id: string) => void;
  onLink: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(memory.body);
  const [summary, setSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);

  useEffect(() => {
    setEditing(false);
    setDraft(memory.body);
    setSummary(null);
    getSummary(memory.id)
      .then((r) => setSummary(r.summary))
      .catch(() => setSummary(null));
  }, [memory.id, memory.body]);

  const related = edges
    .filter((e) => e.src === memory.id || e.dst === memory.id)
    .map((e) => {
      const other = e.src === memory.id ? e.dst : e.src;
      return { id: other, kind: e.kind, out: e.src === memory.id, m: byId.get(other) };
    });

  const save = async () => {
    try {
      await updateMemory(memory.id, { body: draft });
      setEditing(false);
      toast("Saved", "ok");
    } catch (e) {
      toast(`Save failed: ${(e as Error).message}`, "err");
    }
  };

  const summarize = async () => {
    setSummarizing(true);
    try {
      setSummary((await makeSummary(memory.id)).summary);
    } catch (e) {
      toast(`Summary failed: ${(e as Error).message}`, "err");
    } finally {
      setSummarizing(false);
    }
  };

  return (
    <aside className="flex h-full w-[380px] min-w-[260px] max-w-[48%] shrink-0 flex-col border-l border-border bg-card">
      <div className="flex items-start gap-2 border-b border-border p-3">
        <div className="min-w-0 flex-1">
          <TypeChip type={memory.type} />
          <h2 className="mt-1.5 text-[14px] font-semibold leading-snug">{memory.title}</h2>
        </div>
        <Button size="iconSm" variant="ghost" title="Link…" onClick={() => onLink(memory.id)}>
          <Link2 />
        </Button>
        <Button size="iconSm" variant="ghost" title="Delete" onClick={() => onDelete(memory.id)}>
          <Trash2 />
        </Button>
        <Button size="iconSm" variant="ghost" title="Close" onClick={onClose}>
          <X />
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-4 p-3">
          <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-2 text-[12px]">
            <Sparkles className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            {summary ? (
              <span>{summary}</span>
            ) : (
              <button className="text-muted-foreground hover:text-foreground" disabled={summarizing} onClick={summarize}>
                {summarizing ? "Summarising…" : "Generate a one-sentence summary"}
              </button>
            )}
          </div>

          <section>
            <SectionLabel>Metadata</SectionLabel>
            <dl className="grid grid-cols-[72px_1fr] gap-y-1 text-[12px]">
              <dt className="text-muted-foreground">agents</dt>
              <dd>{memory.agents.join(", ") || "—"}</dd>
              <dt className="text-muted-foreground">projects</dt>
              <dd>{memory.projects.join(", ") || "—"}</dd>
              <dt className="text-muted-foreground">tags</dt>
              <dd className="flex flex-wrap gap-1 font-mono text-[11px]">
                {memory.tags.length ? memory.tags.map((t) => <span key={t} className="rounded bg-muted px-1">{t}</span>) : "—"}
              </dd>
              <dt className="text-muted-foreground">created</dt>
              <dd>{rel(memory.created)}</dd>
              <dt className="text-muted-foreground">updated</dt>
              <dd>{rel(memory.updated)}</dd>
              <dt className="text-muted-foreground">confidence</dt>
              <dd>{memory.confidence}</dd>
            </dl>
          </section>

          <section>
            <SectionLabel>Related ({related.length})</SectionLabel>
            {related.length === 0 && <div className="text-[12px] text-muted-foreground">No links yet.</div>}
            <ul className="space-y-0.5">
              {related.map((r) => (
                <li key={`${r.id}-${r.kind}-${r.out}`}>
                  <button
                    className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[12px] hover:bg-accent"
                    onClick={() => onNavigate(r.id)}
                  >
                    <span className="size-1.5 shrink-0 rounded-full" style={{ background: typeFill(r.m?.type ?? "") }} />
                    <span className="min-w-0 flex-1 truncate">{r.m?.title ?? r.id}</span>
                    <span className="shrink-0 font-mono text-2xs text-muted-foreground">
                      {r.out ? "→" : "←"} {r.kind}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <div className="flex items-center justify-between">
              <SectionLabel>Body</SectionLabel>
              {!editing && (
                <button className="mb-1.5 text-muted-foreground hover:text-foreground" title="Edit" onClick={() => setEditing(true)}>
                  <Pencil className="size-3" />
                </button>
              )}
            </div>
            {editing ? (
              <div className="space-y-1.5">
                <Textarea
                  autoFocus
                  rows={14}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save();
                    if (e.key === "Escape") {
                      e.stopPropagation();
                      setEditing(false);
                      setDraft(memory.body);
                    }
                  }}
                  className="font-mono text-[12px]"
                />
                <div className="flex items-center justify-end gap-1.5 text-2xs text-muted-foreground">
                  <kbd>⌘⏎</kbd> save · <kbd>esc</kbd> cancel
                  <Button size="sm" variant="default" onClick={save}>
                    Save
                  </Button>
                </div>
              </div>
            ) : (
              <Markdown body={memory.body} onNavigate={onNavigate} />
            )}
          </section>

          <section>
            <SectionLabel>Source</SectionLabel>
            <button
              className="flex w-full items-center gap-1.5 break-all rounded bg-muted px-2 py-1 text-left font-mono text-[11px] text-muted-foreground hover:text-foreground"
              onClick={() => {
                copy(memory.path);
                toast("Path copied", "ok");
              }}
            >
              <Copy className="size-3 shrink-0" />
              {memory.path}
            </button>
          </section>
        </div>
      </ScrollArea>
    </aside>
  );
}
