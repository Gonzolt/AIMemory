import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import ForceGraph2D from "react-force-graph-2d";
import type { Edge, GraphSettings, Memory } from "@/types";
import { EDGE_COLORS, ageColor, hashColor, typeFill, typeRing } from "@/lib/colors";
import { isTyping } from "@/lib/utils";

export type GNode = {
  id: string;
  mem: Memory;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number;
  fy?: number;
};
type GLink = { source: string | GNode; target: string | GNode; kind: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FG = any;

const DAY = 86400000;
const RIPPLE_MS = 1400;

const endId = (e: string | GNode) => (typeof e === "string" ? e : e.id);

export function nodeRadius(m: Memory, degree: number, s: GraphSettings): number {
  let raw: number;
  if (s.sizeBy === "recency") {
    const days = Math.max(0, (Date.now() - Date.parse(m.updated)) / DAY);
    raw = 5 + Math.max(0, 7 - Math.sqrt(days) * 1.4);
  } else if (s.sizeBy === "confidence") {
    raw = m.confidence === "high" ? 10 : m.confidence === "low" ? 4 : 6.5;
  } else {
    raw = 4.5 + Math.min(7, Math.sqrt(degree) * 1.9);
  }
  return Math.max(3.5, raw * s.nodeSize);
}

export function nodeColor(m: Memory, s: GraphSettings): string {
  switch (s.colorBy) {
    case "project":
      return hashColor(m.projects[0]);
    case "agent":
      return hashColor(m.agents[0]);
    case "age":
      return ageColor(m.updated);
    default:
      return typeFill(m.type);
  }
}

function withAlpha(hex: string, a: number): string {
  if (hex.startsWith("#") && hex.length === 7) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  return hex;
}

export function GraphView({
  memories,
  edges,
  degree,
  settings,
  selectedId,
  latestId,
  ripples,
  fgRef,
  nodesById,
  onSelect,
  onContextMenu,
  onLink,
}: {
  memories: Memory[];
  edges: Edge[];
  degree: Map<string, number>;
  settings: GraphSettings;
  selectedId: string | null;
  latestId?: string;
  ripples: MutableRefObject<Map<string, number>>;
  fgRef: MutableRefObject<FG>;
  nodesById: MutableRefObject<Map<string, GNode>>;
  onSelect: (id: string | null) => void;
  onContextMenu: (id: string, x: number, y: number) => void;
  onLink: (src: string, dst: string) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [hoverId, setHoverId] = useState<string | null>(null);
  const lHeld = useRef(false);
  const fitted = useRef(false);
  const lastBgClick = useRef(0);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.key === "l" || e.key === "L") && !isTyping(e)) lHeld.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "l" || e.key === "L") lHeld.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const data = useMemo(() => {
    const map = nodesById.current;
    const nodes: GNode[] = memories.map((m) => {
      const n = map.get(m.id) ?? ({ id: m.id } as GNode);
      n.mem = m;
      map.set(m.id, n);
      return n;
    });
    const links: GLink[] = edges.map((e) => ({ source: e.src, target: e.dst, kind: e.kind }));
    return { nodes, links };
  }, [memories, edges]);

  const neighbors = useMemo(() => {
    const nb = new Map<string, Set<string>>();
    for (const e of edges) {
      if (!nb.has(e.src)) nb.set(e.src, new Set());
      if (!nb.has(e.dst)) nb.set(e.dst, new Set());
      nb.get(e.src)!.add(e.dst);
      nb.get(e.dst)!.add(e.src);
    }
    return nb;
  }, [edges]);

  const focusId = hoverId ?? selectedId;
  const focusSet = useMemo(() => {
    if (!focusId) return null;
    return new Set([focusId, ...(neighbors.get(focusId) ?? [])]);
  }, [focusId, neighbors]);

  const hubLabels = useMemo(() => {
    const visible = new Set(memories.map((m) => m.id));
    return new Set(
      [...degree.entries()]
        .filter(([id, d]) => d >= 2 && visible.has(id))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([id]) => id),
    );
  }, [degree, memories]);

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    fg.d3Force("link")?.distance(settings.linkDistance);
    fg.d3Force("charge")?.strength(settings.chargeStrength);
    fg.d3ReheatSimulation();
  }, [settings.linkDistance, settings.chargeStrength, fgRef]);

  const linkFocused = (l: GLink) => !!focusId && (endId(l.source) === focusId || endId(l.target) === focusId);

  return (
    <div ref={wrap} className="graph-canvas absolute inset-0">
      <ForceGraph2D
        ref={fgRef}
        width={size.w}
        height={size.h}
        graphData={data}
        backgroundColor="rgba(0,0,0,0)"
        nodeRelSize={5}
        cooldownTicks={140}
        d3AlphaDecay={0.018}
        d3VelocityDecay={0.32}
        autoPauseRedraw={false}
        linkCurvature={0}
        nodeLabel={() => ""}
        onEngineStop={() => {
          if (!fitted.current && data.nodes.length) {
            fitted.current = true;
            fgRef.current?.zoomToFit(400, 60);
          }
        }}
        nodeCanvasObject={(node: GNode, ctx: CanvasRenderingContext2D, scale: number) => {
          const m = node.mem;
          if (!m || node.x === undefined || node.y === undefined) return;
          const r = nodeRadius(m, degree.get(m.id) ?? 0, settings);
          const fill = nodeColor(m, settings);
          const dim = focusSet && !focusSet.has(m.id);
          const now = Date.now();
          if (m.id === latestId && !dim) {
            const g = ctx.createRadialGradient(node.x, node.y, r * 0.6, node.x, node.y, r * 3.2);
            g.addColorStop(0, withAlpha(typeRing(m.type), 0.35));
            g.addColorStop(1, "rgba(0,0,0,0)");
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(node.x, node.y, r * 3.2, 0, 2 * Math.PI);
            ctx.fill();
            const phase = (now % 1600) / 1600;
            ctx.strokeStyle = withAlpha(typeRing(m.type), 0.6 * (1 - phase));
            ctx.lineWidth = 1.2 / scale;
            ctx.beginPath();
            ctx.arc(node.x, node.y, r + 2 + phase * 8, 0, 2 * Math.PI);
            ctx.stroke();
          }
          const start = ripples.current.get(m.id);
          if (start !== undefined) {
            const p = (now - start) / RIPPLE_MS;
            if (p >= 1) ripples.current.delete(m.id);
            else {
              ctx.strokeStyle = `rgba(244,244,245,${0.8 * (1 - p)})`;
              ctx.lineWidth = 1.6 / scale;
              ctx.beginPath();
              ctx.arc(node.x, node.y, r + p * 28, 0, 2 * Math.PI);
              ctx.stroke();
            }
          }
          ctx.beginPath();
          ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
          ctx.fillStyle = dim ? withAlpha(fill, 0.16) : fill;
          ctx.fill();
          if (!dim && now - Date.parse(m.updated) < DAY) {
            ctx.strokeStyle = withAlpha(typeRing(m.type), 0.85);
            ctx.lineWidth = 1 / scale;
            ctx.beginPath();
            ctx.arc(node.x, node.y, r + 2.5 / scale + 1, 0, 2 * Math.PI);
            ctx.stroke();
          }
          if (m.id === selectedId) {
            ctx.strokeStyle = "rgba(244,244,245,0.95)";
            ctx.lineWidth = 1.6 / scale;
            ctx.beginPath();
            ctx.arc(node.x, node.y, r + 1.5 / scale, 0, 2 * Math.PI);
            ctx.stroke();
          }
        }}
        nodePointerAreaPaint={(node: GNode, color: string, ctx: CanvasRenderingContext2D) => {
          if (!node.mem || node.x === undefined || node.y === undefined) return;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(node.x, node.y, nodeRadius(node.mem, degree.get(node.id) ?? 0, settings) + 2, 0, 2 * Math.PI);
          ctx.fill();
        }}
        onRenderFramePost={(ctx: CanvasRenderingContext2D, scale: number) => {
          const show = new Set(hubLabels);
          if (focusSet) focusSet.forEach((id) => show.add(id));
          if (selectedId) show.add(selectedId);
          const fs = 11 / scale;
          ctx.font = `500 ${fs}px Inter, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          for (const id of show) {
            const n = nodesById.current.get(id);
            if (!n || !n.mem || n.x === undefined || n.y === undefined) continue;
            if (!data.nodes.includes(n)) continue;
            const r = nodeRadius(n.mem, degree.get(id) ?? 0, settings);
            const text = n.mem.title.length > 38 ? n.mem.title.slice(0, 37) + "…" : n.mem.title;
            const w = ctx.measureText(text).width;
            const pad = 4 / scale;
            const y = n.y + r + 5 / scale + fs / 2 + pad;
            ctx.globalAlpha = settings.labelOpacity;
            ctx.fillStyle = "rgba(8,8,8,0.92)";
            const x0 = n.x - w / 2 - pad;
            const y0 = y - fs / 2 - pad * 0.7;
            const rw = w + pad * 2;
            const rh = fs + pad * 1.4;
            const rr = 3 / scale;
            ctx.beginPath();
            ctx.moveTo(x0 + rr, y0);
            ctx.arcTo(x0 + rw, y0, x0 + rw, y0 + rh, rr);
            ctx.arcTo(x0 + rw, y0 + rh, x0, y0 + rh, rr);
            ctx.arcTo(x0, y0 + rh, x0, y0, rr);
            ctx.arcTo(x0, y0, x0 + rw, y0, rr);
            ctx.fill();
            ctx.fillStyle = "rgba(236,236,238,1)";
            ctx.fillText(text, n.x, y);
            ctx.globalAlpha = 1;
          }
        }}
        linkColor={(l: GLink) => {
          if (focusId) return linkFocused(l) ? "rgba(244,244,245,0.9)" : "rgba(148,163,184,0.05)";
          return EDGE_COLORS[l.kind] ?? EDGE_COLORS.default;
        }}
        linkWidth={(l: GLink) => (focusId ? (linkFocused(l) ? 1.6 : 0.3) : 0.85)}
        linkDirectionalParticles={1}
        linkDirectionalParticleWidth={(l: GLink) => (focusId && !linkFocused(l) ? 0 : 1.4)}
        linkDirectionalParticleSpeed={0.004}
        linkDirectionalParticleColor={() => "rgba(255,255,255,0.85)"}
        linkCanvasObjectMode={() => (settings.showEdgeLabels ? "after" : undefined)}
        linkCanvasObject={(l: GLink, ctx: CanvasRenderingContext2D, scale: number) => {
          const s = l.source as GNode;
          const t = l.target as GNode;
          if (s.x === undefined || t.x === undefined || s.y === undefined || t.y === undefined) return;
          const fs = 9 / scale;
          ctx.font = `${fs}px "JetBrains Mono", monospace`;
          ctx.fillStyle = "rgba(160,160,170,0.85)";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(l.kind.replace("_", " "), (s.x + t.x) / 2, (s.y + t.y) / 2);
        }}
        onNodeHover={(n: GNode | null) => setHoverId(n ? n.id : null)}
        onNodeClick={(n: GNode) => onSelect(n.id)}
        onNodeRightClick={(n: GNode, e: MouseEvent) => {
          e.preventDefault();
          onContextMenu(n.id, e.clientX, e.clientY);
        }}
        onBackgroundClick={() => {
          const now = Date.now();
          if (now - lastBgClick.current < 320) onSelect(null);
          lastBgClick.current = now;
        }}
        onNodeDragEnd={(n: GNode) => {
          n.fx = n.x;
          n.fy = n.y;
          if (!lHeld.current || n.x === undefined || n.y === undefined) return;
          let best: GNode | null = null;
          let bestD = 60;
          for (const o of data.nodes) {
            if (o.id === n.id || o.x === undefined || o.y === undefined) continue;
            const d = Math.hypot(o.x - n.x, o.y - n.y);
            if (d < bestD) {
              bestD = d;
              best = o;
            }
          }
          if (best) onLink(n.id, best.id);
        }}
      />
    </div>
  );
}
