/**
 * Server-side helpers for reading/writing project state files.
 * All functions run in Node.js (API Routes only, not client-side).
 */
import fs from "fs/promises";
import path from "path";
import { PROJECTS_BASE_DIR, StepName, STEP_ORDER } from "./services";

export type StepStatus = "pending" | "in_progress" | "stopped" | "completed" | "failed";

export interface StoryboardResult {
  shot_count: number;
  storyboard_path: string;
  shots?: Array<{
    shot_id: string;
    shot_type?: string;
    duration?: number;
    action?: string;
    dialogue?: string;
  }>;
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
}

/** Per-shot file presence on disk — computed field, never persisted to state.json */
export interface ShotFileCounts {
  image_shots: string[];  // shot_ids that have an image in images/
  video_shots: string[];  // shot_ids that have a clip in clips/
}

export interface ProjectState {
  project_id: string;
  title: string;
  episode: string;
  created_at: string;
  steps: Record<StepName, StepState>;
  shot_file_counts?: ShotFileCounts;  // computed at readState time, not stored
}

export interface ProjectMeta {
  id: string;
  title: string;
  episode: string;
  created_at: string;
  steps: Record<StepName, StepStatus>;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function computeShotFileCounts(id: string): Promise<ShotFileCounts> {
  const dir = projectDir(id);
  const [imgFiles, clipFiles] = await Promise.all([
    fs.readdir(path.join(dir, "images")).catch(() => [] as string[]),
    fs.readdir(path.join(dir, "clips")).catch(() => [] as string[]),
  ]);
  return {
    image_shots: imgFiles
      .filter((f) => /\.(png|jpg|webp)$/i.test(f))
      .map((f) => f.replace(/\.[^.]+$/, "")),   // E01_001.png → E01_001
    video_shots: clipFiles
      .filter((f) => /\.mp4$/i.test(f))
      .map((f) => f.replace(/\.mp4$/i, "")),     // E01_001.mp4 → E01_001
  };
}

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
export async function recoverStepResult(id: string, step: StepName): Promise<StepResult | null> {
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
            shots: sb.shots ?? [],
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

/**
 * Determine the correct status for a recovered step:
 * - storyboard / assembly: always "completed" (generated atomically)
 * - image / tts / video: compare file count against storyboard shot count
 *   → equal  → "completed"
 *   → partial → "stopped"
 */
async function recoverStepStatus(
  dir: string,
  step: StepName,
  result: StepResult,
  shotCount: number,
): Promise<StepStatus> {
  if (step === "storyboard" || step === "assembly") return "completed";

  switch (step) {
    case "image": {
      const count = (result.data as { images: unknown[] }).images?.length ?? 0;
      return count >= shotCount && shotCount > 0 ? "completed" : "stopped";
    }
    case "tts": {
      // Count unique shot IDs covered by audio files
      const audioFiles = (result.data as { audio_files: string[] }).audio_files ?? [];
      const uniqueShots = new Set(audioFiles.map((f) => f.replace(/_[^_]+\.[^.]+$/, "")));
      return uniqueShots.size >= shotCount && shotCount > 0 ? "completed" : "stopped";
    }
    case "video": {
      const count = (result.data as { clips: unknown[] }).clips?.length ?? 0;
      return count >= shotCount && shotCount > 0 ? "completed" : "stopped";
    }
  }
  return "stopped";
  // suppress TS exhaustive warning
  void dir;
}

/** Reconstruct a full ProjectState from disk artifacts when state.json is missing. */
async function recoverStateFromDisk(id: string): Promise<ProjectState | null> {
  const dir = projectDir(id);
  try {
    await fs.access(dir);
  } catch {
    return null;
  }

  // Try to get title/episode and shot count from storyboard.json
  let title = id;
  let episode = "E01";
  let shotCount = 0;
  try {
    const sb = JSON.parse(await fs.readFile(path.join(dir, "storyboard.json"), "utf-8"));
    if (sb.project?.title) title = sb.project.title;
    if (sb.project?.episode != null) episode = `E${String(sb.project.episode).padStart(2, "0")}`;
    shotCount = sb.shots?.length ?? 0;
  } catch {}

  const now = new Date().toISOString();
  const steps = emptySteps();

  for (const step of STEP_ORDER) {
    const result = await recoverStepResult(id, step);
    if (result) {
      const status = await recoverStepStatus(dir, step, result, shotCount);
      steps[step] = { status, job_id: null, updated_at: now };
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

/** Validate and correct step status based on actual file counts vs shot count */
async function validateStepStatuses(id: string, state: ProjectState): Promise<boolean> {
  const dir = projectDir(id);
  let shotCount = 0;
  try {
    const sb = JSON.parse(await fs.readFile(path.join(dir, "storyboard.json"), "utf-8"));
    shotCount = sb.shots?.length ?? 0;
  } catch {
    return false;
  }

  let dirty = false;
  const now = new Date().toISOString();

  for (const step of STEP_ORDER) {
    if (step === "storyboard" || step === "assembly") continue;

    const currentStatus = state.steps[step].status;

    // Get actual file count from disk (needed for both pending and non-pending statuses)
    const result = await recoverStepResult(id, step);

    if (currentStatus === "pending") {
      // Even if status is pending, check if files actually exist on disk.
      // This handles cases where a step was started outside the frontend
      // pipeline API (e.g., direct service API call) and state.json wasn't updated.
      if (result) {
        state.steps[step].status = "stopped";
        state.steps[step].updated_at = now;
        dirty = true;
      }
      continue;
    }
    if (currentStatus === "in_progress") continue; // Active job — don't interfere with running tasks
    if (!result) {
      // No files on disk but state says non-pending/non-in_progress → correct to pending
      state.steps[step].status = "pending";
      state.steps[step].updated_at = now;
      dirty = true;
      continue;
    }

    // Calculate expected status based on file count
    let expectedStatus: StepStatus;

    if (step === "video") {
      // video completion is relative to image count, not storyboard shot count
      const videoCount = (result.data as VideoResult).clips?.length ?? 0;
      const imgFiles = await fs.readdir(path.join(dir, "images")).catch(() => [] as string[]);
      const imageCount = imgFiles.filter((f) => /\.(png|jpg|webp)$/i.test(f)).length;
      expectedStatus =
        imageCount === 0    ? "pending"
        : videoCount === 0  ? "pending"
        : videoCount >= imageCount ? "completed"
        : "stopped";
    } else {
      let actualCount = 0;
      if (step === "image") {
        actualCount = (result.data as ImageResult).images?.length ?? 0;
      } else if (step === "tts") {
        const audioFiles = (result.data as TTSResult).audio_files ?? [];
        actualCount = new Set(audioFiles.map((f) => f.replace(/_[^_]+\.[^.]+$/, ""))).size;
      }
      expectedStatus =
        actualCount === 0
          ? "pending"
          : actualCount >= shotCount && shotCount > 0
            ? "completed"
            : "stopped";
    }

    if (currentStatus !== expectedStatus) {
      state.steps[step].status = expectedStatus;
      state.steps[step].updated_at = now;
      dirty = true;
    }
  }

  return dirty;
}

export async function readState(id: string): Promise<ProjectState> {
  let state: ProjectState;
  try {
    const raw = await fs.readFile(statePath(id), "utf-8");
    state = JSON.parse(raw) as ProjectState;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    const isNotFound = code === "ENOENT";
    const isParseError = err instanceof SyntaxError;
    if (isNotFound || isParseError) {
      // state.json missing or corrupted — rebuild from disk artifacts.
      // recoverStateFromDisk reads title/episode from storyboard.json and
      // rewrites a clean state.json, so subsequent reads will succeed.
      if (isParseError) {
        console.warn(`[project-store] state.json for ${id} is malformed (${(err as SyntaxError).message}), recovering from disk`);
      }
      const recovered = await recoverStateFromDisk(id);
      if (recovered) return recovered;
    }
    throw err;
  }

  // Clean up stale result fields from old format
  let dirty = false;
  for (const step of STEP_ORDER) {
    const s = state.steps[step];
    // Remove result field if present (no longer stored in state.json)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((s as any).result !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (s as any).result;
      dirty = true;
    }
  }

  // Validate file counts and correct status if needed
  // This handles cases where job was interrupted but state wasn't updated
  const statusCorrected = await validateStepStatuses(id, state);
  if (statusCorrected) {
    dirty = true;
  }

  if (dirty) {
    await _writeAtomic(statePath(id), JSON.stringify(state, null, 2));
  }

  // Attach per-shot file lists (computed, never persisted)
  state.shot_file_counts = await computeShotFileCounts(id);

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
  // Ensure computed field is never persisted
  delete (state as Partial<ProjectState>).shot_file_counts;
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
    } catch (err) {
      console.warn(`[project-store] skipping project ${entry}:`, err);
    }
  }
  return results.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

async function _writeAtomic(filePath: string, content: string) {
  const tmp = filePath + ".tmp";
  await fs.writeFile(tmp, content, "utf-8");
  await fs.rename(tmp, filePath);
}
