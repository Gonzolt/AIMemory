import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Check, X } from "lucide-react";
import type { Memory, SimilarPair } from "@/types";
import { MEMORY_TYPES } from "@/types";
import { fetchDuplicates, fetchStale, fetchSuggestLinks, linkMemories } from "@/lib/api";
import { typeFill } from "@/lib/colors";
import { toast } from "@/lib/toast";
import { cn, rel } from "@/lib/utils";
import { Button, Card, Empty, SectionLabel } from "./ui";

const DAY = 86400000;
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <Card className="p-3">
      <div className="text-2xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-[22px] font-semibold tabular-nums">{value}</div>
    </Card>
  );
}

const tooltipStyle = {
  contentStyle: { background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 },
  labelStyle: { color: "hsl(var(--muted-foreground))" },
};

function Heatmap({ memories }: { memories: Memory[] }) {
  const weeks = 24;
  const counts = new Map<string, number>();
  memories.forEach((m) => {
    const k = m.updated.slice(0, 10);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  });
  const today = new Date();
  const start = new Date(today.getTime() - (weeks * 7 - 1) * DAY - today.getDay() * DAY);
  const max = Math.max(1, ...counts.values());
  const cols = [];
  for (let w = 0; w < weeks; w++) {
    const cells = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(start.getTime() + (w * 7 + d) * DAY);
      const k = dayKey(date);
      const n = counts.get(k) ?? 0;
      cells.push(
        <div
          key={k}
          title={`${k}: ${n}`}
          className="size-2.5 rounded-[2px]"
          style={{ background: n ? `rgba(167,186,214,${0.18 + (0.82 * n) / max})` : "hsl(var(--muted))" }}
        />,
      );
    }
    cols.push(
      <div key={w} className="flex flex-col gap-[3px]">
        {cells}
      </div>,
    );
  }
  return <div className="flex gap-[3px] overflow-x-auto">{cols}</div>;
}

function PairList({ pairs, onOpen, action }: { pairs: SimilarPair[]; onOpen: (id: string) => void; action?: (p: SimilarPair) => ReactNode }) {
  if (!pairs.length) return <Empty>None found</Empty>;
  return (
    <ul className="space-y-1">
      {pairs.map((p) => (
        <li key={`${p.a.id}|${p.b.id}`} className="flex items-center gap-2 rounded px-1.5 py-1 text-[12px] hover:bg-accent/50">
          <span className="w-10 shrink-0 font-mono text-2xs text-muted-foreground">{Math.round(p.similarity * 100)}%</span>
          {[p.a, p.b].map((x, i) => (
            <button key={x.id} className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-left hover:underline" onClick={() => onOpen(x.id)}>
              {i === 1 && <span className="text-muted-foreground">↔</span>}
              <span className="size-1.5 shrink-0 rounded-full" style={{ background: typeFill(x.type) }} />
              <span className="truncate">{x.title}</span>
            </button>
          ))}
          {action?.(p)}
        </li>
      ))}
    </ul>
  );
}

export function InsightsView({ memories, onOpen }: { memories: Memory[]; onOpen: (id: string) => void }) {
  const [tab, setTab] = useState<"overview" | "agents">("overview");
  const [dups, setDups] = useState<SimilarPair[]>([]);
  const [sugg, setSugg] = useState<SimilarPair[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [stale, setStale] = useState<{ id: string; type: string; title: string; updated: string }[]>([]);

  useEffect(() => {
    fetchDuplicates().then(setDups).catch(() => {});
    fetchSuggestLinks().then(setSugg).catch(() => {});
    fetchStale(30).then((r) => setStale(r.items)).catch(() => {});
  }, [memories.length]);

  const stats = useMemo(() => {
    const now = Date.now();
    const last7 = memories.filter((m) => now - Date.parse(m.created) < 7 * DAY).length;
    const agents = new Set(memories.flatMap((m) => m.agents));
    const tags = new Map<string, number>();
    memories.forEach((m) => m.tags.forEach((t) => tags.set(t, (tags.get(t) ?? 0) + 1)));
    const perDay = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(now - (13 - i) * DAY);
      const k = dayKey(d);
      return { day: k.slice(5), n: memories.filter((m) => m.created.slice(0, 10) === k).length };
    });
    const byType = MEMORY_TYPES.map((t) => ({ type: t, n: memories.filter((m) => m.type === t).length })).filter((x) => x.n);
    const topTags = [...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16);
    const agentRows = [...agents].map((a) => {
      const mine = memories.filter((m) => m.agents.includes(a));
      return {
        name: a,
        writes: mine.length,
        types: [...new Set(mine.map((m) => m.type))],
        last: mine.map((m) => m.updated).sort().pop() ?? "",
      };
    }).sort((a, b) => b.writes - a.writes);
    return { last7, agents: agents.size, tags: tags.size, perDay, byType, topTags, agentRows };
  }, [memories]);

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mb-4 flex gap-1">
        {(["overview", "agents"] as const).map((t) => (
          <Button key={t} size="sm" variant={tab === t ? "outline" : "ghost"} onClick={() => setTab(t)}>
            {t === "overview" ? "Overview" : "By agent"}
          </Button>
        ))}
      </div>
      {tab === "overview" ? (
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-3">
            <Stat label="Total memories" value={memories.length} />
            <Stat label="Last 7 days" value={stats.last7} />
            <Stat label="Agents writing" value={stats.agents} />
            <Stat label="Distinct tags" value={stats.tags} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Card className="p-3">
              <SectionLabel>Memories per day · 14 days</SectionLabel>
              <ResponsiveContainer width="100%" height={160}>
                <AreaChart data={stats.perDay} margin={{ left: -24, right: 4, top: 6 }}>
                  <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <Tooltip {...tooltipStyle} />
                  <Area type="monotone" dataKey="n" name="memories" stroke="#a7bad6" fill="#7e95b8" fillOpacity={0.25} strokeWidth={1.5} />
                </AreaChart>
              </ResponsiveContainer>
            </Card>
            <Card className="p-3">
              <SectionLabel>By type</SectionLabel>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={stats.byType} margin={{ left: -24, right: 4, top: 6 }}>
                  <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" vertical={false} />
                  <XAxis dataKey="type" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <Tooltip {...tooltipStyle} cursor={{ fill: "hsl(var(--accent))" }} />
                  <Bar dataKey="n" name="memories" radius={[3, 3, 0, 0]} fill="#8a738a" />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>
          <Card className="p-3">
            <SectionLabel>Activity · last 24 weeks</SectionLabel>
            <Heatmap memories={memories} />
          </Card>
          <div className="grid grid-cols-2 gap-3">
            <Card className="p-3">
              <SectionLabel>Potential duplicates</SectionLabel>
              <PairList pairs={dups} onOpen={onOpen} />
            </Card>
            <Card className="p-3">
              <SectionLabel>Suggested links</SectionLabel>
              <PairList
                pairs={sugg.filter((p) => !dismissed.has(`${p.a.id}|${p.b.id}`))}
                onOpen={onOpen}
                action={(p) => (
                  <span className="flex shrink-0 gap-0.5">
                    <Button
                      size="iconSm"
                      variant="ghost"
                      title="Link (mentions)"
                      onClick={async () => {
                        try {
                          await linkMemories(p.a.id, p.b.id, "mentions");
                          setSugg((s) => s.filter((x) => x !== p));
                          toast("Linked", "ok");
                        } catch (e) {
                          toast((e as Error).message, "err");
                        }
                      }}
                    >
                      <Check />
                    </Button>
                    <Button size="iconSm" variant="ghost" title="Dismiss" onClick={() => setDismissed((d) => new Set(d).add(`${p.a.id}|${p.b.id}`))}>
                      <X />
                    </Button>
                  </span>
                )}
              />
            </Card>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Card className="p-3">
              <SectionLabel>Stale memories · not updated in 30 days</SectionLabel>
              {stale.length === 0 ? (
                <Empty>Nothing stale</Empty>
              ) : (
                <ul className="space-y-0.5">
                  {stale.map((s) => (
                    <li key={s.id}>
                      <button className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[12px] hover:bg-accent" onClick={() => onOpen(s.id)}>
                        <span className="size-1.5 rounded-full" style={{ background: typeFill(s.type) }} />
                        <span className="flex-1 truncate">{s.title}</span>
                        <span className="text-2xs text-muted-foreground">{rel(s.updated)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card className="p-3">
              <SectionLabel>Top tags</SectionLabel>
              <div className="flex flex-wrap gap-1">
                {stats.topTags.map(([t, n]) => (
                  <span key={t} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                    {t} <span className="text-muted-foreground">{n}</span>
                  </span>
                ))}
              </div>
            </Card>
          </div>
        </div>
      ) : (
        <Card className="p-3">
          <SectionLabel>Agents · write counts</SectionLabel>
          <table className="w-full text-[12px]">
            <thead className="text-left text-2xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="py-1 font-medium">Agent</th>
                <th className="font-medium">Writes</th>
                <th className="font-medium">Types</th>
                <th className="font-medium">Last</th>
              </tr>
            </thead>
            <tbody>
              {stats.agentRows.map((a) => (
                <tr key={a.name} className="border-t border-border">
                  <td className="py-1.5 font-mono">{a.name}</td>
                  <td className="tabular-nums">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 rounded bg-[#7e95b8]" style={{ width: `${(a.writes / (stats.agentRows[0]?.writes || 1)) * 120}px` }} />
                      {a.writes}
                    </div>
                  </td>
                  <td>
                    <div className="flex gap-1">
                      {a.types.map((t) => (
                        <span key={t} title={t} className={cn("size-2 rounded-full")} style={{ background: typeFill(t) }} />
                      ))}
                    </div>
                  </td>
                  <td className="text-muted-foreground">{rel(a.last)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
