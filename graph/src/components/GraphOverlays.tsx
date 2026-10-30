import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import type { ColorBy, GraphSettings, Memory, MemoryType, SizeBy } from "@/types";
import { DEFAULT_SETTINGS, MEMORY_TYPES } from "@/types";
import { typeFill } from "@/lib/colors";
import { cn } from "@/lib/utils";
import { Button, Select } from "./ui";
import type { FG, GNode } from "./GraphView";

// ------------------------------------------------------------------ GraphControls

function Slider({ label, value, min, max, step, onChange, fmt }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  fmt?: (v: number) => string;
}) {
  return (
    <label className="block">
      <div className="mb-0.5 flex justify-between text-2xs text-muted-foreground">
        <span>{label}</span>
        <span className="font-mono">{fmt ? fmt(value) : value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-full cursor-pointer accent-zinc-300"
      />
    </label>
  );
}

export function GraphControls({ settings, onChange }: { settings: GraphSettings; onChange: (s: GraphSettings) => void }) {
  const [open, setOpen] = useState(false);
  const set = <K extends keyof GraphSettings>(k: K, v: GraphSettings[K]) => onChange({ ...settings, [k]: v });
  if (!open)
    return (
      <Button size="icon" variant="outline" className="absolute right-3 top-3 bg-card/80 backdrop-blur" onClick={() => setOpen(true)} title="Graph controls">
        <SlidersHorizontal />
      </Button>
    );
  return (
    <div className="absolute right-3 top-3 w-56 space-y-2.5 rounded-lg border border-border bg-card/95 p-3 shadow-xl backdrop-blur">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium">Graph</span>
        <button className="text-muted-foreground hover:text-foreground" onClick={() => setOpen(false)}>
          <X className="size-3.5" />
        </button>
      </div>
      <Slider label="Link distance" value={settings.linkDistance} min={30} max={250} step={5} onChange={(v) => set("linkDistance", v)} />
      <Slider label="Repulsion" value={settings.chargeStrength} min={-800} max={-50} step={10} onChange={(v) => set("chargeStrength", v)} />
      <Slider label="Node size" value={settings.nodeSize} min={0.5} max={2} step={0.05} onChange={(v) => set("nodeSize", v)} fmt={(v) => `×${v.toFixed(2)}`} />
      <Slider label="Label opacity" value={settings.labelOpacity} min={0} max={1} step={0.05} onChange={(v) => set("labelOpacity", v)} fmt={(v) => v.toFixed(2)} />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="mb-0.5 text-2xs text-muted-foreground">Color by</div>
          <Select
            className="w-full"
            value={settings.colorBy}
            onChange={(v) => set("colorBy", v as ColorBy)}
            options={["type", "project", "agent", "age"].map((v) => ({ value: v, label: v }))}
          />
        </div>
        <div>
          <div className="mb-0.5 text-2xs text-muted-foreground">Size by</div>
          <Select
            className="w-full"
            value={settings.sizeBy}
            onChange={(v) => set("sizeBy", v as SizeBy)}
            options={["links", "recency", "confidence"].map((v) => ({ value: v, label: v }))}
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-[12px]">
        <input type="checkbox" checked={settings.showOnlyConnected} onChange={(e) => set("showOnlyConnected", e.target.checked)} />
        Only connected
      </label>
      <label className="flex items-center gap-2 text-[12px]">
        <input type="checkbox" checked={settings.showEdgeLabels} onChange={(e) => set("showEdgeLabels", e.target.checked)} />
        Edge labels
      </label>
      <Button size="sm" variant="ghost" className="w-full" onClick={() => onChange(DEFAULT_SETTINGS)}>
        Reset defaults
      </Button>
    </div>
  );
}

// ------------------------------------------------------------------ TypeLegend

export function TypeLegend({ nodes, active, onToggle }: { nodes: Memory[]; active: Set<MemoryType>; onToggle: (t: MemoryType) => void }) {
  const counts = new Map<string, number>();
  nodes.forEach((n) => counts.set(n.type, (counts.get(n.type) ?? 0) + 1));
  return (
    <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-border bg-card/90 px-1.5 py-1 shadow-lg backdrop-blur">
      {MEMORY_TYPES.filter((t) => counts.get(t)).map((t) => (
        <button
          key={t}
          onClick={() => onToggle(t)}
          className={cn(
            "flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs transition-opacity hover:bg-accent",
            !active.has(t) && "opacity-35",
          )}
        >
          <span className="size-2 rounded-full" style={{ background: typeFill(t) }} />
          {t}
          <span className="font-mono text-muted-foreground">{counts.get(t)}</span>
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ MiniMap

export function MiniMap({ fgRef, nodesById, nodes }: { fgRef: MutableRefObject<FG>; nodesById: MutableRefObject<Map<string, GNode>>; nodes: Memory[] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const bounds = useRef({ minX: 0, minY: 0, scale: 1, ox: 0, oy: 0 });
  const W = 160;
  const H = 104;

  useEffect(() => {
    const t = window.setInterval(() => {
      const fg = fgRef.current;
      const c = canvas.current;
      if (!fg || !c) return;
      const visible = new Set(nodes.map((m) => m.id));
      const ns = [...nodesById.current.values()].filter((n) => visible.has(n.id) && n.x !== undefined && n.y !== undefined);
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, W, H);
      if (!ns.length) return;
      const xs = ns.map((n) => n.x!);
      const ys = ns.map((n) => n.y!);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const scale = Math.min((W - 12) / Math.max(1, maxX - minX), (H - 12) / Math.max(1, maxY - minY));
      const ox = (W - (maxX - minX) * scale) / 2;
      const oy = (H - (maxY - minY) * scale) / 2;
      bounds.current = { minX, minY, scale, ox, oy };
      for (const n of ns) {
        ctx.fillStyle = typeFill(n.mem?.type ?? "");
        ctx.fillRect(ox + (n.x! - minX) * scale - 1, oy + (n.y! - minY) * scale - 1, 2.2, 2.2);
      }
      try {
        const el = c.closest(".graph-host") as HTMLElement | null;
        if (el) {
          const a = fg.screen2GraphCoords(0, 0);
          const b = fg.screen2GraphCoords(el.clientWidth, el.clientHeight);
          ctx.strokeStyle = "rgba(255,255,255,0.4)";
          ctx.lineWidth = 1;
          ctx.strokeRect(ox + (a.x - minX) * scale, oy + (a.y - minY) * scale, (b.x - a.x) * scale, (b.y - a.y) * scale);
        }
      } catch {
        /* graph not mounted yet */
      }
    }, 400);
    return () => window.clearInterval(t);
  }, [fgRef, nodesById, nodes]);

  return (
    <canvas
      ref={canvas}
      width={W}
      height={H}
      className="absolute bottom-3 right-3 cursor-pointer rounded-md border border-border bg-card/80 backdrop-blur"
      onClick={(e) => {
        const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
        const { minX, minY, scale, ox, oy } = bounds.current;
        const gx = (e.clientX - r.left - ox) / scale + minX;
        const gy = (e.clientY - r.top - oy) / scale + minY;
        fgRef.current?.centerAt(gx, gy, 400);
      }}
    />
  );
}
