export type MemoryType =
  | "user"
  | "feedback"
  | "project"
  | "reference"
  | "decision"
  | "conversation"
  | "code"
  | "task";

export const MEMORY_TYPES: MemoryType[] = [
  "user",
  "feedback",
  "project",
  "reference",
  "decision",
  "conversation",
  "code",
  "task",
];

export type EdgeKind = "part_of" | "derived_from" | "supersedes" | "conflicts_with" | "mentions" | "produced_by";

export const EDGE_KINDS: EdgeKind[] = ["mentions", "part_of", "derived_from", "supersedes", "conflicts_with", "produced_by"];

export interface Memory {
  id: string;
  type: MemoryType;
  title: string;
  body: string;
  path: string;
  created: string;
  updated: string;
  agents: string[];
  projects: string[];
  tags: string[];
  status: string;
  confidence: string;
  file_mtime?: number | null;
  rank?: number;
}

export interface Edge {
  src: string;
  dst: string;
  kind: EdgeKind | string;
}

export interface GraphData {
  nodes: Memory[];
  edges: Edge[];
}

export type View =
  | "graph"
  | "memories"
  | "tasks"
  | "insights"
  | "benchmark"
  | "projects"
  | "code"
  | "agents"
  | "help"
  | "settings";

export type ColorBy = "type" | "project" | "agent" | "age";
export type SizeBy = "links" | "recency" | "confidence";

export interface GraphSettings {
  linkDistance: number;
  chargeStrength: number;
  nodeSize: number;
  labelOpacity: number;
  showOnlyConnected: boolean;
  showEdgeLabels: boolean;
  colorBy: ColorBy;
  sizeBy: SizeBy;
}

export const DEFAULT_SETTINGS: GraphSettings = {
  linkDistance: 130,
  chargeStrength: -360,
  nodeSize: 1.15,
  labelOpacity: 1,
  showOnlyConnected: false,
  showEdgeLabels: false,
  colorBy: "type",
  sizeBy: "links",
};

export interface AimEvent {
  type: string;
  ts?: number;
  id?: string;
  op?: string;
  agent?: string;
  ids?: string[];
  query?: string;
  path?: string;
  project?: string;
}

export interface ProjectSummary {
  project: string;
  files: number;
  bytes: number;
  languages: { name: string; files: number }[];
}

export interface CodeHit {
  path: string;
  project: string;
  line_start: number;
  line_end: number;
  body: string;
  rank: number;
}

export interface SimilarPair {
  a: { id: string; title: string; type: MemoryType };
  b: { id: string; title: string; type: MemoryType };
  similarity: number;
}

export type TaskStatus = "todo" | "doing" | "blocked" | "done";
