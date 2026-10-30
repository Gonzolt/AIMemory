import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { Copy, ExternalLink, FileText, Link2, Pin, PinOff, Trash2, ZoomIn } from "lucide-react";
import type { EdgeKind, Memory } from "@/types";
import { EDGE_KINDS } from "@/types";
import { cn, isPinned } from "@/lib/utils";
import { typeFill } from "@/lib/colors";
import { Button, Dialog, DialogContent, Input } from "./ui";

export function NodeContextMenu({
  memory,
  x,
  y,
  onClose,
  onLink,
  onDrill,
  onTogglePin,
  onCopy,
  onDelete,
}: {
  memory: Memory;
  x: number;
  y: number;
  onClose: () => void;
  onLink: () => void;
  onDrill: () => void;
  onTogglePin: () => void;
  onCopy: (what: "id" | "path") => void;
  onDelete: () => void;
}) {
  useEffect(() => {
    const close = () => onClose();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("click", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", esc);
    };
  }, [onClose]);

  const pinned = isPinned(memory);
  const items: { icon: ReactNode; label: string; run: () => void; danger?: boolean }[] = [
    { icon: <Link2 />, label: "Link…", run: onLink },
    { icon: <ZoomIn />, label: "Drill in", run: onDrill },
    { icon: pinned ? <PinOff /> : <Pin />, label: pinned ? "Unpin" : "Pin", run: onTogglePin },
    { icon: <Copy />, label: "Copy id", run: () => onCopy("id") },
    { icon: <FileText />, label: "Copy path", run: () => onCopy("path") },
    { icon: <ExternalLink />, label: "Open file", run: () => window.open(`file://${memory.path.replace(/\\/g, "/")}`) },
    { icon: <Trash2 />, label: "Delete", run: onDelete, danger: true },
  ];
  return (
    <div
      className="fixed z-50 w-44 rounded-md border border-border bg-card py-1 shadow-2xl"
      style={{ left: Math.min(x, window.innerWidth - 190), top: Math.min(y, window.innerHeight - 260) }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="truncate px-2.5 pb-1 pt-0.5 text-2xs text-muted-foreground">{memory.title}</div>
      {items.map((it) => (
        <button
          key={it.label}
          className={cn(
            "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] hover:bg-accent [&_svg]:size-3.5",
            it.danger && "text-red-300",
          )}
          onClick={() => {
            onClose();
            it.run();
          }}
        >
          {it.icon}
          {it.label}
        </button>
      ))}
    </div>
  );
}

const KIND_HINTS: Record<EdgeKind, string> = {
  mentions: "Soft reference",
  part_of: "Subordinate / belongs to",
  derived_from: "Based on / inspired by",
  supersedes: "Replaces an older one",
  conflicts_with: "Tension or contradiction",
  produced_by: "Output of (e.g. task → memory)",
};

export function LinkPicker({
  source,
  memories,
  onClose,
  onLink,
}: {
  source: Memory;
  memories: Memory[];
  onClose: () => void;
  onLink: (dst: string, kind: EdgeKind) => void;
}) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<EdgeKind>("mentions");
  const [idx, setIdx] = useState(0);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return memories
      .filter((m) => m.id !== source.id && (!s || m.title.toLowerCase().includes(s) || m.id.includes(s)))
      .slice(0, 50);
  }, [q, memories, source.id]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Link “${source.title}” to…`}>
        <Input
          autoFocus
          placeholder="Search memories"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setIdx(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setIdx((i) => Math.min(i + 1, list.length - 1));
            if (e.key === "ArrowUp") setIdx((i) => Math.max(i - 1, 0));
            if (e.key === "Enter" && list[idx]) onLink(list[idx].id, kind);
          }}
        />
        <div className="mt-2 grid grid-cols-3 gap-1">
          {EDGE_KINDS.map((k) => (
            <button
              key={k}
              title={KIND_HINTS[k]}
              onClick={() => setKind(k)}
              className={cn(
                "rounded-md border border-border px-2 py-1 text-left text-[11px] hover:bg-accent",
                kind === k && "border-ring bg-accent",
              )}
            >
              <div className="font-mono">{k}</div>
              <div className="truncate text-2xs text-muted-foreground">{KIND_HINTS[k]}</div>
            </button>
          ))}
        </div>
        <div className="mt-2 max-h-64 overflow-y-auto">
          {list.map((m, i) => (
            <button
              key={m.id}
              onClick={() => onLink(m.id, kind)}
              onMouseEnter={() => setIdx(i)}
              className={cn("flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px]", i === idx && "bg-accent")}
            >
              <span className="size-1.5 rounded-full" style={{ background: typeFill(m.type) }} />
              <span className="min-w-0 flex-1 truncate">{m.title}</span>
              <span className="font-mono text-2xs text-muted-foreground">{m.type}</span>
            </button>
          ))}
        </div>
        <div className="mt-2 flex justify-end">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
