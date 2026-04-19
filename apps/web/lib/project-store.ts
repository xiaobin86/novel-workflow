/**
 * Server-side helpers for reading/writing project state files.
 * All functions run in Node.js (API Routes only, not client-side).
 */
import fs from "fs/promises";
import path from "path";
import { PROJECTS_BASE_DIR, StepName, STEP_ORDER } from "./services";

export type StepStatus = "pending" | "in_progress" | "completed" | "failed";

export interface StepState {
  status: StepStatus;
  job_id: string | null;
  updated_at: string;
}

export interface ProjectState {
  project_id: string;
  title: string;
  episode: string;
  created_at: string;
  steps: Record<StepName, StepState>;
}

export interface ProjectMeta {
  id: string;
  title: string;
  episode: string;
  created_at: string;
  steps: Record<StepName, StepStatus>;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function projectDir(id: string) {
  return path.join(PROJECTS_BASE_DIR, id);
}

function statePath(id: string) {
  return path.join(projectDir(id), "state.json");
}

function emptySteps(): Record<StepName, StepState> {
  const now = new Date().toISOString();
  return Object.fromEntries(
    STEP_ORDER.map((s) => [s, { status: "pending" as StepStatus, job_id: null, updated_at: now }])
  ) as Record<StepName, StepState>;
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function createProject(id: string, title: string, episode: string, text?: string) {
  const dir = projectDir(id);
  await fs.mkdir(dir, { recursive: true });

  const state: ProjectState = {
    project_id: id,
    title,
    episode,
    created_at: new Date().toISOString(),
    steps: emptySteps(),
  };
  await _writeAtomic(statePath(id), JSON.stringify(state, null, 2));

  if (text) {
    await fs.writeFile(path.join(dir, "input.txt"), text, "utf-8");
  }
  return state;
}

export async function readState(id: string): Promise<ProjectState> {
  const raw = await fs.readFile(statePath(id), "utf-8");
  return JSON.parse(raw) as ProjectState;
}

export async function updateStep(
  id: string,
  step: StepName,
  patch: Partial<StepState>
) {
  const state = await readState(id);
  state.steps[step] = {
    ...state.steps[step],
    ...patch,
    updated_at: new Date().toISOString(),
  };
  await _writeAtomic(statePath(id), JSON.stringify(state, null, 2));
  return state;
}

export async function listProjects(): Promise<ProjectMeta[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(PROJECTS_BASE_DIR);
  } catch {
    return [];
  }

  const results: ProjectMeta[] = [];
  for (const entry of entries) {
    try {
      const state = await readState(entry);
      results.push({
        id: state.project_id,
        title: state.title,
        episode: state.episode,
        created_at: state.created_at,
        steps: Object.fromEntries(
          Object.entries(state.steps).map(([k, v]) => [k, v.status])
        ) as Record<StepName, StepStatus>,
      });
    } catch {
      // skip malformed projects
    }
  }
  return results.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

async function _writeAtomic(filePath: string, content: string) {
  const tmp = filePath + ".tmp";
  await fs.writeFile(tmp, content, "utf-8");
  await fs.rename(tmp, filePath);
}
