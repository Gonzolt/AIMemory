import type { MemoryType } from "@/types";

export interface UiTemplate {
  id: string;
  label: string;
  type: MemoryType;
  title: () => string;
  body: string;
  tags: string[];
}

const today = () => new Date().toISOString().slice(0, 10);

export const TEMPLATES: UiTemplate[] = [
  {
    id: "adr",
    label: "ADR",
    type: "decision",
    title: () => "Use X for Y",
    body: "**Context**\n…\n\n**Decision**\n…\n\n**Consequences**\n…\n\n**Alternatives considered**\n- A — rejected because …\n- B — rejected because …",
    tags: ["adr", "architecture"],
  },
  {
    id: "standup",
    label: "Standup",
    type: "conversation",
    title: () => `Standup — ${today()}`,
    body: "**Yesterday**\n- …\n\n**Today**\n- …\n\n**Blockers**\n- …",
    tags: ["standup"],
  },
  {
    id: "postmortem",
    label: "Post-mortem",
    type: "decision",
    title: () => "Post-mortem: …",
    body: "**Symptom**\n…\n\n**Root cause**\n…\n\n**Fix**\n…\n\n**Prevention**\n…",
    tags: ["bug", "post-mortem"],
  },
  {
    id: "meeting",
    label: "Meeting",
    type: "conversation",
    title: () => `Meeting — ${today()}`,
    body: "**Attendees**\n- …\n\n**Decisions**\n- …\n\n**Follow-ups**\n- [ ] …",
    tags: ["meeting"],
  },
  {
    id: "task",
    label: "Task",
    type: "task",
    title: () => "Short imperative goal",
    body: "**Goal**\n…\n\n**Context**\n…\n\n**Acceptance**\n- [ ] …",
    tags: ["status:todo"],
  },
  {
    id: "research",
    label: "Research",
    type: "reference",
    title: () => "Research: …",
    body: "**Question**\n…\n\n**Sources**\n- …\n\n**Findings**\n…\n\n**Implications**\n…",
    tags: ["research"],
  },
];
