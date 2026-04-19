export const SERVICE_URLS = {
  storyboard: process.env.STORYBOARD_SERVICE_URL ?? "http://localhost:8001",
  image:      process.env.IMAGE_SERVICE_URL      ?? "http://localhost:8002",
  tts:        process.env.TTS_SERVICE_URL        ?? "http://localhost:8003",
  video:      process.env.VIDEO_SERVICE_URL      ?? "http://localhost:8004",
  assembly:   process.env.ASSEMBLY_SERVICE_URL   ?? "http://localhost:8005",
} as const;

export type StepName = keyof typeof SERVICE_URLS;

export const STEP_ORDER: StepName[] = ["storyboard", "image", "tts", "video", "assembly"];

export const STEP_LABELS: Record<StepName, string> = {
  storyboard: "分镜生成",
  image:      "图片生成",
  tts:        "TTS 配音",
  video:      "视频生成",
  assembly:   "素材合并",
};

export const PROJECTS_BASE_DIR = process.env.PROJECTS_BASE_DIR ?? "/app/projects";
