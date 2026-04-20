/**
 * Server-side helpers for reading/writing project state files.
 * All functions run in Node.js (API Routes only, not client-side).
 */
import fs from "fs/promises";
import path from "path";
import { PROJECTS_BASE_DIR, StepName, STEP_ORDER } from "./services";

export type StepStatus = "pending" | "in_progress" | "paused" | "stopped" | "completed" | "failed";

export interface StoryboardResult {
  shot_count: number;
  storyboard_path: string;
}

export interface ImageResult {
  images: Array<{ shot_id: string; filename: string }>;
  total: number;
}

export interface TTSResult {
  audio_files: string[];
  total_tracks: number;
}

export interface VideoResult {
  clips: Array<{ shot_id: string; filename: string; duration: number }>;
  total: number;
}

export interface AssemblyResult {
  video_path: string;
  srt_path: string;
  duration: number;
}

export type StepResult =
  | { type: "storyboard"; data: StoryboardResult }
  | { type: "image"; data: ImageResult }
  | { type: "tts"; data: TTSResult }
  | { type: "video"; data: VideoResult }
  | { type: "assembly"; data: AssemblyResult };

export interface StepState {
  status: StepStatus;
  job_id: string | null;
  updated_at: string;
  result?: StepResult | null;
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

// ── Recovery helpers ───────────────────────────────────────────────────────────

/** Scan disk artifacts for one step and reconstruct its StepResult. */
async function recoverStepResult(id: string, step: StepName): Promise<StepResult | null> {
  const dir = projectDir(id);
  try {
    switch (step) {
      case "storyboard": {
        const raw = await fs.readFile(path.join(dir, "storyboard.json"), "utf-8");
        const sb = JSON.parse(raw);
        return {
          type: "storyboard",
          data: {
            shot_count: sb.shots?.length ?? 0,
            storyboard_path: path.join(dir, "storyboard.json"),
          },
        };
      }
      case "image": {
        const files = await fs.readdir(path.join(dir, "images")).catch(() => [] as string[]);
        const imgs = files.filter((f) => /\.(png|jpg|webp)$/i.test(f));
        if (!imgs.length) return null;
        return {
          type: "image",
          data: {
            images: imgs.map((f) => ({ shot_id: f.replace(/\.[^.]+$/, ""), filename: f })),
            total: imgs.length,
          },
        };
      }
      case "tts": {
        const files = await fs.readdir(path.join(dir, "audio")).catch(() => [] as string[]);
        const audio = files.filter((f) => /\.(mp3|wav)$/i.test(f)).sort();
        if (!audio.length) return null;
        return {
          type: "tts",
          data: { audio_files: audio, total_tracks: audio.length },
        };
      }
      case "video": {
        const files = await fs.readdir(path.join(dir, "clips")).catch(() => [] as string[]);
        const clips = files.filter((f) => /\.mp4$/i.test(f)).sort();
        if (!clips.length) return null;
        return {
          type: "video",
          data: {
            clips: clips.map((f) => ({ shot_id: f.replace(/\.mp4$/i, ""), filename: f, duration: 0 })),
            total: clips.length,
          },
        };
      }
      case "assembly": {
        const finalMp4 = path.join(dir, "output", "final.mp4");
        await fs.access(finalMp4);
        return {
          type: "assembly",
          data: { video_path: finalMp4, srt_path: path.join(dir, "output", "final.srt"), duration: 0 },
        };
      }
    }
  } catch {
    return null;
  }
  return null;
}

/** Reconstruct a full ProjectState from disk artifacts when state.json is missing. */
async function recoverStateFromDisk(id: string): Promise<ProjectState | null> {
  const dir = projectDir(id);
  try {
    await fs.access(dir);
  } catch {
    return null;
  }

  // Try to get title/episode from storyboard.json
  let title = id;
  let episode = "E01";
  try {
    const sb = JSON.parse(await fs.readFile(path.join(dir, "storyboard.json"), "utf-8"));
    if (sb.project?.title) title = sb.project.title;
    if (sb.project?.episode != null) episode = `E${String(sb.project.episode).padStart(2, "0")}`;
  } catch {}

  const now = new Date().toISOString();
  const steps = emptySteps();

  for (const step of STEP_ORDER) {
    const result = await recoverStepResult(id, step);
    if (result) {
      steps[step] = { status: "completed", job_id: null, updated_at: now, result };
    }
  }

  const state: ProjectState = { project_id: id, title, episode, created_at: now, steps };
  // Persist so next load is instant
  await _writeAtomic(statePath(id), JSON.stringify(state, null, 2));
  return state;
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
  let state: ProjectState;
  try {
    const raw = await fs.readFile(statePath(id), "utf-8");
    state = JSON.parse(raw) as ProjectState;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      // state.json missing — rebuild from artifacts
      const recovered = await recoverStateFromDisk(id);
      if (recovered) return recovered;
    }
    throw err;
  }

  // Fill in missing / migrate old-format results for completed steps
  let dirty = false;
  for (const step of STEP_ORDER) {
    const s = state.steps[step];
    if (s?.status !== "completed") continue;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = s.result as any;

    // Case 1: no result at all — recover from disk
    if (!raw) {
      const result = await recoverStepResult(id, step);
      if (result) { state.steps[step] = { ...s, result }; dirty = true; }
      continue;
    }

    // Case 2: old format (no `type` field) — wrap it
    if (!raw.type) {
      state.steps[step] = { ...s, result: { type: step, data: raw } as StepResult };
      dirty = true;
    }
  }
  if (dirty) {
    await _writeAtomic(statePath(id), JSON.stringify(state, null, 2));
  }

  return state;
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
