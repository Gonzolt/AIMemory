// Memory Galaxy — every memory a star, every project a hub, agent activity as light.
import ForceGraph3D from "3d-force-graph";
import * as THREE from "three";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import SpriteText from "three-spritetext";

const API = "/api";
const BG = "#0a0b16";

const COLORS = {
  hub: "#ffffff",
  user: "#ffffff",
  feedback: "#efeaff",
  decision: "#a78bfa",
  task: "#cbbcff",
  reference: "#6f8cff",
  project: "#c3c9e8",
  code: "#c3c9e8",
  conversation: "#6c7398",
};

const LEGEND = [
  ["Projects", COLORS.hub],
  ["Decisions", COLORS.decision],
  ["Rules (feedback)", COLORS.feedback],
  ["Project notes", COLORS.project],
  ["References", COLORS.reference],
  ["Sessions", COLORS.conversation],
  ["Tasks", COLORS.task],
  ["Profile", COLORS.user],
  ["Code", COLORS.code],
];

const LINK_STYLE = {
  typed: { color: "rgba(196,178,255,.5)", distance: 48, strength: 0.35, particles: 2, rank: 0 },
  wiki: { color: "rgba(146,164,255,.38)", distance: 48, strength: 0.3, particles: 1, rank: 1 },
  hub: { color: "rgba(118,124,196,.17)", distance: 60, strength: 0.5, particles: 0, rank: 2 },
  similar: { color: "rgba(120,118,214,.15)", distance: 72, strength: 0.05, particles: 0, rank: 3 },
};

const VERBS = { search: "searched", read: "read", context: "recalled", write: "wrote", link: "linked", ask: "asked" };

const STOP = new Set(
  `the and for that with this from are was were not but you your have has had into what when where which
about after before how all any our out one two use used new now did does should would could also than then
them they their there these those will just only some more most such very can each other over under
og er det som en på til av med ikke har var de den et vi jeg du kan skal vil må fra men om så når
eller hva hvor hvordan alle mer noe noen være blir ble bare også etter før`.split(/\s+/),
);

// ------------------------------------------------------------------ data

const $ = (id) => document.getElementById(id);
const nodeById = new Map();
let memories = [];
let edgesRaw = [];

function tokens(text) {
  return (text.toLowerCase().match(/[a-zæøå][a-zæøå0-9-]{2,}/g) || []).filter((t) => !STOP.has(t));
}

function similarPairs(mems) {
  const N = mems.length;
  if (N < 3) return [];
  const docs = mems.map((m) => {
    const tf = new Map();
    const add = (t, w) => tf.set(t, (tf.get(t) || 0) + w);
    tokens(m.title).forEach((t) => add(t, 3));
    (m.tags || []).forEach((tag) => tokens(tag.replace(/[:_]/g, " ")).forEach((t) => add(t, 2)));
    tokens(m.body || "").forEach((t) => add(t, 1));
    return tf;
  });
  const df = new Map();
  docs.forEach((d) => d.forEach((_, t) => df.set(t, (df.get(t) || 0) + 1)));
  const maxDf = Math.max(2, N * 0.25);
  const vecs = docs.map((d) => {
    const v = new Map();
    let norm = 0;
    d.forEach((tf, t) => {
      const f = df.get(t);
      if (f < 2 || f > maxDf) return;
      const w = (1 + Math.log(tf)) * Math.log(N / f);
      v.set(t, w);
      norm += w * w;
    });
    norm = Math.sqrt(norm) || 1;
    v.forEach((w, t) => v.set(t, w / norm));
    return v;
  });
  const pairs = [];
  for (let i = 0; i < N; i++) {
    const scores = [];
    for (let j = 0; j < N; j++) {
      if (i === j) continue;
      const [a, b] = vecs[i].size < vecs[j].size ? [vecs[i], vecs[j]] : [vecs[j], vecs[i]];
      let s = 0;
      a.forEach((w, t) => {
        const o = b.get(t);
        if (o) s += w * o;
      });
      if (s >= 0.14) scores.push([j, s]);
    }
    scores.sort((x, y) => y[1] - x[1]);
    scores.slice(0, 3).forEach(([j]) => pairs.push([mems[i].id, mems[j].id]));
  }
  return pairs;
}

function buildData(prevNodes) {
  const ids = new Set(memories.map((m) => m.id));
  const projects = [...new Set(memories.flatMap((m) => m.projects || []))];
  const nodes = [];
  const keep = new Map(prevNodes.map((n) => [n.id, n]));

  projects.forEach((p) => {
    const id = `hub:${p}`;
    const n = keep.get(id) || { id };
    Object.assign(n, { kind: "hub", title: p, color: COLORS.hub, val: 6 });
    nodes.push(n);
  });
  memories.forEach((m) => {
    let n = keep.get(m.id);
    if (!n) {
      n = { id: m.id };
      const hub = m.projects?.[0] && keep.get(`hub:${m.projects[0]}`);
      if (hub && hub.x !== undefined) {
        n.x = hub.x + (Math.random() - 0.5) * 20;
        n.y = hub.y + (Math.random() - 0.5) * 20;
        n.z = hub.z + (Math.random() - 0.5) * 20;
      }
    }
    Object.assign(n, { kind: "memory", mem: m, title: m.title, color: COLORS[m.type] || COLORS.project, val: 1.4 });
    nodes.push(n);
  });

  // one link per pair, strongest kind wins
  const best = new Map();
  const put = (a, b, kind) => {
    if (a === b) return;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    const cur = best.get(key);
    if (!cur || LINK_STYLE[kind].rank < LINK_STYLE[cur.kind].rank) best.set(key, { source: a, target: b, kind });
  };
  edgesRaw.forEach((e) => ids.has(e.src) && ids.has(e.dst) && put(e.src, e.dst, "typed"));
  memories.forEach((m) => {
    for (const mt of (m.body || "").matchAll(/\[\[([^\]|#]+)/g)) {
      const t = mt[1].trim();
      if (ids.has(t)) put(m.id, t, "wiki");
    }
    (m.projects || []).forEach((p) => put(m.id, `hub:${p}`, "hub"));
  });
  similarPairs(memories).forEach(([a, b]) => put(a, b, "similar"));

  const degree = new Map();
  best.forEach((l) => {
    if (l.kind === "hub" || l.kind === "similar") return;
    degree.set(l.source, (degree.get(l.source) || 0) + 1);
    degree.set(l.target, (degree.get(l.target) || 0) + 1);
  });
  nodes.forEach((n) => {
    if (n.kind === "memory") n.val = 1.2 + Math.min(5, (degree.get(n.id) || 0) * 0.8);
    nodeById.set(n.id, n);
  });
  return { nodes, links: [...best.values()], projects };
}

// ------------------------------------------------------------------ scene

const meshes = new Map();
const sphereGeo = new THREE.SphereGeometry(1, 16, 12);

const Graph = new ForceGraph3D($("graph"), { controlType: "orbit" })
  .backgroundColor(BG)
  .cooldownTicks(160)
  .showNavInfo(false)
  .nodeLabel((n) => `<div style="font:12px Inter;padding:2px 6px;background:rgba(10,11,22,.85);border-radius:4px">${escapeHtml(n.title)}</div>`)
  .nodeThreeObject((n) => {
    const group = new THREE.Group();
    const r = n.kind === "hub" ? 3.2 : 1.1 + Math.sqrt(n.val) * 0.9;
    const mat = new THREE.MeshBasicMaterial({ color: n.color, transparent: true, opacity: n.kind === "hub" ? 1 : 0.92 });
    const mesh = new THREE.Mesh(sphereGeo, mat);
    mesh.scale.setScalar(r);
    mesh.userData.base = r;
    group.add(mesh);
    if (n.kind === "hub") {
      const label = new SpriteText(n.title, 3.2, "rgba(230,232,245,0.85)");
      label.fontFace = "Inter";
      label.position.y = r + 4;
      group.add(label);
    }
    meshes.set(n.id, mesh);
    return group;
  })
  .linkColor((l) => LINK_STYLE[l.kind].color)
  .linkWidth((l) => (l.kind === "typed" ? 0.5 : l.kind === "wiki" ? 0.35 : 0.2))
  .linkOpacity(1)
  .linkDirectionalParticles((l) => LINK_STYLE[l.kind].particles)
  .linkDirectionalParticleWidth(0.9)
  .linkDirectionalParticleSpeed(0.004)
  .linkDirectionalParticleColor(() => "#e9e4ff")
  .onNodeClick((n) => openPanel(n))
  .onBackgroundClick(() => closePanel());

Graph.d3Force("link")
  .distance((l) => LINK_STYLE[l.kind].distance)
  .strength((l) => LINK_STYLE[l.kind].strength);
Graph.d3Force("charge").strength(-60);

const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.5, 0.4, 0.6);
Graph.postProcessingComposer().addPass(bloom);
Graph.postProcessingComposer().addPass(new OutputPass()); // linear → sRGB for the composer's float target
// The raw clear colour skips colour management inside the composer and comes out grey; a scene background doesn't.
Graph.scene().background = new THREE.Color(BG);

window.addEventListener("resize", () => Graph.width(window.innerWidth).height(window.innerHeight));
window.__galaxy = { Graph, bloom, THREE }; // console handle for debugging

// ------------------------------------------------------------------ live effects

const ripples = new Map(); // id → start ms
const trails = []; // { line, start }
let lastInteraction = Date.now();
let flying = false;
let angle = 0;

["mousedown", "wheel", "touchstart", "keydown"].forEach((ev) =>
  window.addEventListener(ev, () => (lastInteraction = Date.now()), { passive: true }),
);

function ripple(ids) {
  const now = Date.now();
  ids.forEach((id) => ripples.set(id, now));
  const pts = ids.map((id) => nodeById.get(id)).filter((n) => n && n.x !== undefined);
  if (pts.length > 1) {
    const geo = new THREE.BufferGeometry().setFromPoints(pts.map((n) => new THREE.Vector3(n.x, n.y, n.z)));
    const mat = new THREE.LineBasicMaterial({ color: 0xc4b2ff, transparent: true, opacity: 0.9 });
    const line = new THREE.Line(geo, mat);
    Graph.scene().add(line);
    trails.push({ line, start: now });
  }
}

function tick() {
  const now = Date.now();
  ripples.forEach((start, id) => {
    const mesh = meshes.get(id);
    const p = (now - start) / 1800;
    if (!mesh || p >= 1) {
      if (mesh) {
        mesh.scale.setScalar(mesh.userData.base);
        mesh.material.color.set(nodeById.get(id)?.color || "#ffffff");
      }
      ripples.delete(id);
      return;
    }
    const pulse = 1 + Math.sin(p * Math.PI) * 1.6;
    mesh.scale.setScalar(mesh.userData.base * pulse);
    mesh.material.color.set("#ffffff");
  });
  for (let i = trails.length - 1; i >= 0; i--) {
    const t = trails[i];
    const p = (now - t.start) / 6000;
    if (p >= 1) {
      Graph.scene().remove(t.line);
      t.line.geometry.dispose();
      t.line.material.dispose();
      trails.splice(i, 1);
    } else t.line.material.opacity = 0.9 * (1 - p);
  }
  if (!flying && now - lastInteraction > 4000) {
    const cam = Graph.camera();
    const dist = Math.hypot(cam.position.x, cam.position.z) || 300;
    angle = Math.atan2(cam.position.x, cam.position.z) + 0.0009;
    Graph.cameraPosition({ x: dist * Math.sin(angle), y: cam.position.y, z: dist * Math.cos(angle) });
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

function feed(text) {
  const el = document.createElement("div");
  el.innerHTML = text;
  $("feed").prepend(el);
  while ($("feed").children.length > 5) $("feed").lastChild.remove();
}

// ------------------------------------------------------------------ panel, search, ask

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function excerpt(body, n = 600) {
  const s = (body || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, "$1")
    .replace(/[#*_`>]+/g, "")
    .trim();
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function relPath(path) {
  const p = (path || "").replace(/\\/g, "/");
  const i = p.lastIndexOf("/memories/");
  return i >= 0 ? p.slice(i + "/memories/".length) : p;
}

function neighborsOf(id) {
  const out = [];
  Graph.graphData().links.forEach((l) => {
    const s = typeof l.source === "object" ? l.source.id : l.source;
    const t = typeof l.target === "object" ? l.target.id : l.target;
    if (s === id) out.push([t, l.kind]);
    else if (t === id) out.push([s, l.kind]);
  });
  return out.sort((a, b) => LINK_STYLE[a[1]].rank - LINK_STYLE[b[1]].rank).slice(0, 10);
}

function focusNode(n, ms = 1400) {
  if (!n || n.x === undefined) return;
  const d = 70;
  const r = 1 + d / Math.max(1, Math.hypot(n.x, n.y, n.z));
  Graph.cameraPosition({ x: n.x * r, y: n.y * r, z: n.z * r }, n, ms);
}

function openPanel(n) {
  lastInteraction = Date.now();
  const p = $("panel");
  const near = neighborsOf(n.id)
    .map(([id, kind]) => {
      const o = nodeById.get(id);
      return o ? `<button data-id="${escapeHtml(id)}">${escapeHtml(o.title)} <span style="color:var(--muted);font-size:10px">· ${kind}</span></button>` : "";
    })
    .join("");
  if (n.kind === "hub") {
    p.innerHTML = `<h2>${escapeHtml(n.title)}</h2><div class="meta">project hub</div><div class="near">${near}</div>`;
  } else {
    const m = n.mem;
    const obsidian = `obsidian://open?vault=memories&file=${encodeURIComponent(relPath(m.path))}`;
    p.innerHTML = `<h2>${escapeHtml(m.title)}</h2>
      <div class="meta">${escapeHtml(m.type)} · ${escapeHtml(m.id)}${m.projects?.length ? " · " + escapeHtml(m.projects.join(", ")) : ""}</div>
      <div class="excerpt">${escapeHtml(excerpt(m.body))}</div>
      ${near ? `<div class="meta" style="margin:10px 0 0">Nearby</div><div class="near">${near}</div>` : ""}
      <div class="actions"><a href="${obsidian}">Open in Obsidian</a><a id="closepanel">Close</a></div>`;
  }
  p.style.display = "block";
  p.querySelectorAll("button[data-id]").forEach((b) =>
    b.addEventListener("click", () => {
      const o = nodeById.get(b.dataset.id);
      if (o) {
        focusNode(o);
        openPanel(o);
      }
    }),
  );
  $("closepanel")?.addEventListener("click", closePanel);
  focusNode(n);
}

function closePanel() {
  $("panel").style.display = "none";
}

async function flyPast(ids) {
  flying = true;
  const stars = ids.map((id) => nodeById.get(id)).filter(Boolean).slice(0, 4);
  for (const n of stars) {
    focusNode(n, 1900);
    ripple([n.id]);
    await new Promise((r) => setTimeout(r, 1900));
  }
  const set = new Set(stars.map((n) => n.id));
  if (set.size) Graph.zoomToFit(1200, 80, (n) => set.has(n.id));
  setTimeout(() => {
    flying = false;
    lastInteraction = Date.now();
  }, 1300);
}

async function askQuestion(q) {
  const box = $("answer");
  box.style.display = "block";
  box.innerHTML = `<span style="color:var(--muted)">Reading the relevant memories…</span>`;
  try {
    const r = await fetch(`${API}/ask`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ q }) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || r.statusText);
    const html = escapeHtml(data.answer).replace(/\[([a-z0-9][a-z0-9-]*)\]/g, (m, id) =>
      nodeById.has(id) ? `<a data-id="${id}">[${id}]</a>` : m,
    );
    box.innerHTML = `<span class="close">×</span>${html.replace(/\n/g, "<br>")}`;
    box.querySelector(".close").addEventListener("click", () => (box.style.display = "none"));
    box.querySelectorAll("a[data-id]").forEach((a) =>
      a.addEventListener("click", () => {
        const n = nodeById.get(a.dataset.id);
        if (n) openPanel(n);
      }),
    );
    if (data.cited?.length) flyPast(data.cited);
  } catch (e) {
    box.innerHTML = `<span class="close">×</span><span style="color:#ff9b9b">${escapeHtml(e.message)}</span>`;
    box.querySelector(".close").addEventListener("click", () => (box.style.display = "none"));
  }
}

$("q").addEventListener("keydown", async (e) => {
  if (e.key !== "Enter") return;
  const q = e.target.value.trim();
  if (!q) return;
  if (q.endsWith("?")) return askQuestion(q);
  $("answer").style.display = "none";
  const r = await fetch(`${API}/search?q=${encodeURIComponent(q)}&limit=12`);
  const { results = [] } = await r.json();
  const ids = results.map((m) => m.id).filter((id) => nodeById.has(id));
  if (!ids.length) return feed(`no stars match “${escapeHtml(q)}”`);
  ripple(ids);
  const set = new Set(ids);
  Graph.zoomToFit(1200, 80, (n) => set.has(n.id));
  openPanel(nodeById.get(ids[0]));
});

// ------------------------------------------------------------------ load + live

function renderHud(projects) {
  const links = Graph.graphData().links.filter((l) => l.kind === "typed" || l.kind === "wiki").length;
  $("stats").textContent = `${memories.length} memories · ${links} links · ${projects.length} projects`;
  $("legend").innerHTML = LEGEND.map(([label, c]) => `<div><span class="dot" style="background:${c};color:${c}"></span>${label}</div>`).join("");
}

async function load() {
  const r = await fetch(`${API}/graph`);
  const data = await r.json();
  memories = data.nodes || [];
  edgesRaw = data.edges || [];
  const built = buildData(Graph.graphData().nodes || []);
  Graph.graphData({ nodes: built.nodes, links: built.links });
  renderHud(built.projects);
  $("loading").style.display = "none";
}

let reloadTimer;
function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(load, 250);
}

function connect() {
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
  ws.onmessage = (m) => {
    let e;
    try {
      e = JSON.parse(m.data);
    } catch {
      return;
    }
    if (e.type === "memory_changed" || e.type === "memory_deleted") scheduleReload();
    if (e.type === "memory_accessed" && e.ids?.length) {
      ripple(e.ids);
      const verb = VERBS[e.op] || e.op;
      const q = e.query ? ` “${escapeHtml(e.query.slice(0, 60))}”` : "";
      feed(`<b>${escapeHtml(e.agent || "agent")}</b> ${verb}${q} · ${e.ids.length} ${e.ids.length === 1 ? "memory" : "memories"}`);
    }
  };
  ws.onclose = () => setTimeout(connect, 1500);
}

let fitted = false;
Graph.onEngineStop(() => {
  if (fitted) return;
  fitted = true;
  flying = true;
  Graph.zoomToFit(1200, 40);
  setTimeout(() => {
    flying = false;
    lastInteraction = Date.now();
  }, 1400);
});

flying = true; // hold auto-rotate until the first fit
Graph.cameraPosition({ x: 0, y: 0, z: 320 });
load()
  .catch((e) => ($("loading").textContent = `Can't reach the API (${e.message}). Start it with: aim start`));
connect();
