import { useEffect, useRef, useState } from "react";
import { Bot, FileText, Square, Trash2, X } from "lucide-react";
import type { Memory, TaskStatus } from "@/types";
import { deleteMemory, dispatchLog, dispatchTask, stopDispatch, updateMemory } from "@/lib/api";
import { toast } from "@/lib/toast";
import { cn, rel, taskAgent, taskStatus, withStatus } from "@/lib/utils";
import { Button, Empty, Select } from "./ui";

const COLUMNS: { id: TaskStatus; label: string; dot: string }[] = [
  { id: "todo", label: "Todo", dot: "bg-zinc-400" },
  { id: "doing", label: "Doing", dot: "bg-amber-400" },
  { id: "blocked", label: "Blocked", dot: "bg-rose-400" },
  { id: "done", label: "Done", dot: "bg-emerald-400" },
];

export function TasksView({ tasks, onOpen }: { tasks: Memory[]; onOpen: (id: string) => void }) {
  const [logFor, setLogFor] = useState<string | null>(null);

  const setStatus = async (m: Memory, s: TaskStatus) => {
    try {
      await updateMemory(m.id, { tags: withStatus(m.tags, s) });
    } catch (e) {
      toast(`Update failed: ${(e as Error).message}`, "err");
    }
  };

  const dispatch = async (m: Memory, runner: "claude" | "codex") => {
    try {
      const r = await dispatchTask(m.id, runner);
      toast(`Dispatched to ${runner} (pid ${r.pid})`, "ok");
      setLogFor(m.id);
    } catch (e) {
      toast(`Dispatch failed: ${(e as Error).message}`, "err");
    }
  };

  const remove = async (m: Memory) => {
    if (!window.confirm("Delete this memory? The .md file will be removed.")) return;
    try {
      await deleteMemory(m.id);
    } catch (e) {
      toast(`Delete failed: ${(e as Error).message}`, "err");
    }
  };

  return (
    <div className="flex h-full min-h-0">
      <div className="grid min-h-0 flex-1 grid-cols-4 gap-3 overflow-x-auto p-4">
        {COLUMNS.map((col) => {
          const items = tasks.filter((t) => taskStatus(t) === col.id);
          return (
            <div key={col.id} className="flex min-h-0 min-w-[220px] flex-col rounded-lg border border-border bg-card/50">
              <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-[12px] font-medium">
                <span className={cn("size-2 rounded-full", col.dot)} />
                {col.label}
                <span className="font-mono text-2xs text-muted-foreground">{items.length}</span>
              </div>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
                {items.length === 0 && <Empty>Nothing here</Empty>}
                {items.map((t) => (
                  <div key={t.id} className="rounded-md border border-border bg-card p-2.5">
                    <button className="block w-full text-left text-[12px] font-medium leading-snug hover:underline" onClick={() => onOpen(t.id)}>
                      {t.title}
                    </button>
                    <div className="mt-1 flex items-center gap-2 text-2xs text-muted-foreground">
                      {taskAgent(t) && <span className="font-mono">@{taskAgent(t)}</span>}
                      <span>{rel(t.updated)}</span>
                    </div>
                    <div className="mt-2 flex items-center gap-1">
                      <Select
                        className="h-6 text-[11px]"
                        value={taskStatus(t)}
                        onChange={(v) => setStatus(t, v as TaskStatus)}
                        options={COLUMNS.map((c) => ({ value: c.id, label: c.label }))}
                      />
                      <div className="flex-1" />
                      <Button size="iconSm" variant="ghost" title="Dispatch to claude" onClick={() => dispatch(t, "claude")}>
                        <Bot />
                      </Button>
                      <Button size="sm" variant="ghost" className="px-1 font-mono" title="Dispatch to codex" onClick={() => dispatch(t, "codex")}>
                        cx
                      </Button>
                      <Button size="iconSm" variant="ghost" title="Logs" onClick={() => setLogFor(t.id)}>
                        <FileText />
                      </Button>
                      <Button size="iconSm" variant="ghost" title="Delete" onClick={() => remove(t)}>
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {logFor && <DispatchPanel taskId={logFor} onClose={() => setLogFor(null)} />}
    </div>
  );
}

export function DispatchPanel({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const [lines, setLines] = useState<string[]>([]);
  const [exists, setExists] = useState(true);
  const [running, setRunning] = useState(false);
  const [follow, setFollow] = useState(true);
  const box = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await dispatchLog(taskId, 500);
        if (!alive) return;
        setLines(r.lines);
        setExists(r.exists);
        setRunning(!!r.running);
      } catch {
        /* API down; keep last view */
      }
    };
    void poll();
    const t = window.setInterval(poll, 1500);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [taskId]);

  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lines, follow]);

  return (
    <aside className="flex w-[440px] shrink-0 flex-col border-l border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className={cn("size-1.5 rounded-full", running ? "bg-amber-400" : "bg-zinc-600")} />
        <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{taskId}</span>
        <label className="flex items-center gap-1 text-2xs text-muted-foreground">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> auto-scroll
        </label>
        <Button
          size="sm"
          variant="danger"
          disabled={!running}
          onClick={async () => {
            const r = await stopDispatch(taskId);
            toast(r.already_exited ? "Already exited" : "Stopped", "info");
          }}
        >
          <Square /> Stop
        </Button>
        <Button size="iconSm" variant="ghost" onClick={onClose}>
          <X />
        </Button>
      </div>
      <pre ref={box} className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
        {exists ? lines.join("\n") || "(empty log)" : "No dispatch log for this task yet."}
      </pre>
    </aside>
  );
}
