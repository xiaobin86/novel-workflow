"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type {
  StepResult,
  ImageResult,
  TTSResult,
  VideoResult,
  AssemblyResult,
} from "@/lib/project-store";

// ── Storyboard ────────────────────────────────────────────────────────────────

interface StoryboardShot {
  shot_id: string;
  shot_type?: string;
  duration?: number;
  action?: string;
  dialogue?: string;
}

interface StoryboardData {
  shots: StoryboardShot[];
}

export function StoryboardArtifacts({
  projectId,
}: {
  projectId: string;
}) {
  const [data, setData] = useState<StoryboardData | null>(null);

  useEffect(() => {
    fetch(`/api/projects/${projectId}/files/storyboard.json`)
      .then((r) => {
        if (!r.ok) throw new Error("Failed to fetch storyboard");
        return r.json();
      })
      .then((json: StoryboardData) => setData(json))
      .catch(() => setData(null));
  }, [projectId]);

  if (!data?.shots?.length) return null;

  return (
    <div className="overflow-y-auto max-h-64 space-y-2 pr-2">
      {data.shots.map((shot) => (
        <div key={shot.shot_id} className="bg-zinc-50 rounded p-3 text-sm">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono font-medium text-zinc-700">
              {shot.shot_id}
            </span>
            {shot.shot_type && (
              <span className="text-xs bg-zinc-200 text-zinc-600 px-1.5 py-0.5 rounded">
                {shot.shot_type}
              </span>
            )}
            {shot.duration !== undefined && (
              <span className="text-xs text-zinc-500">{shot.duration}s</span>
            )}
          </div>
          {shot.action && <p className="text-zinc-700">{shot.action}</p>}
          {shot.dialogue && (
            <p className="text-zinc-500 mt-1">「{shot.dialogue}」</p>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Images ────────────────────────────────────────────────────────────────────

export function ImageArtifacts({
  result,
  projectId,
}: {
  result: ImageResult;
  projectId: string;
}) {
  if (!result.images?.length) return null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
      {result.images.map((img) => (
        <div
          key={img.filename}
          className="relative aspect-video bg-zinc-100 rounded overflow-hidden"
        >
          <img
            src={`/api/projects/${projectId}/files/images/${img.filename}`}
            alt={img.shot_id}
            loading="lazy"
            className="w-full h-full object-cover"
          />
          <span className="absolute bottom-1 left-1 text-xs bg-black/60 text-white px-1.5 py-0.5 rounded">
            {img.shot_id}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── TTS ───────────────────────────────────────────────────────────────────────

function parseAudioFilename(filename: string): {
  shotId: string;
  trackType: string;
} {
  const base = filename.replace(/\.[^.]+$/, "");
  const parts = base.split("_");
  const trackType = parts.pop() ?? "";
  const shotId = parts.join("_");
  return { shotId, trackType };
}

function getTrackLabel(trackType: string): string {
  if (trackType === "dialogue") return "旁白";
  if (trackType === "action") return "台词";
  return trackType;
}

export function TTSArtifacts({
  result,
  projectId,
}: {
  result: TTSResult;
  projectId: string;
}) {
  if (!result.audio_files?.length) return null;

  return (
    <div className="overflow-y-auto max-h-64 space-y-2 pr-2">
      {result.audio_files.map((filename) => {
        const { shotId, trackType } = parseAudioFilename(filename);
        const trackLabel = getTrackLabel(trackType);

        return (
          <div key={filename} className="bg-zinc-50 rounded p-3">
            <p className="text-sm font-medium text-zinc-700 mb-1">
              {shotId} · {trackLabel}
            </p>
            <audio
              controls
              src={`/api/projects/${projectId}/files/audio/${filename}`}
              className="w-full h-8"
            />
          </div>
        );
      })}
    </div>
  );
}

// ── Video ─────────────────────────────────────────────────────────────────────

export function VideoArtifacts({
  result,
  projectId,
}: {
  result: VideoResult;
  projectId: string;
}) {
  if (!result.clips?.length) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {result.clips.map((clip) => (
        <div
          key={clip.filename}
          className="bg-zinc-50 rounded overflow-hidden"
        >
          <video
            controls
            preload="metadata"
            src={`/api/projects/${projectId}/files/clips/${clip.filename}`}
            className="w-full rounded"
          />
          <div className="px-3 py-2 flex items-center justify-between">
            <span className="text-sm font-medium text-zinc-700">
              {clip.shot_id}
            </span>
            <span className="text-xs text-zinc-500">{clip.duration}s</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Assembly ──────────────────────────────────────────────────────────────────

export function AssemblyArtifacts({
  result,
  projectId,
}: {
  result: AssemblyResult;
  projectId: string;
}) {
  return (
    <div className="space-y-3">
      <video
        controls
        preload="metadata"
        src={`/api/projects/${projectId}/files/output/final.mp4`}
        className="w-full rounded bg-zinc-100"
      />
      <div className="flex items-center justify-between">
        <span className="text-sm text-zinc-600">
          时长: {result.duration ? `${result.duration}s` : "未知"}
        </span>
        <div className="flex gap-2">
          <a
            href={`/api/projects/${projectId}/files/output/final.mp4?download=1`}
          >
            <Button size="sm" variant="outline">
              下载 MP4
            </Button>
          </a>
          <a
            href={`/api/projects/${projectId}/files/output/final.srt?download=1`}
          >
            <Button size="sm" variant="outline">
              下载 SRT
            </Button>
          </a>
        </div>
      </div>
    </div>
  );
}

// ── Router ────────────────────────────────────────────────────────────────────

export function StepArtifacts({
  result,
  projectId,
}: {
  result?: StepResult | null;
  projectId: string;
}) {
  if (!result) return null;

  switch (result.type) {
    case "storyboard":
      return <StoryboardArtifacts projectId={projectId} />;
    case "image":
      return <ImageArtifacts result={result.data} projectId={projectId} />;
    case "tts":
      return <TTSArtifacts result={result.data} projectId={projectId} />;
    case "video":
      return <VideoArtifacts result={result.data} projectId={projectId} />;
    case "assembly":
      return <AssemblyArtifacts result={result.data} projectId={projectId} />;
    default:
      return null;
  }
}
