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
import type { ProgressArtifact } from "@/hooks/useStepProgress";
import type { StepName } from "@/lib/services";

// Global ref to track the currently playing audio element
// so clicking play on another audio stops the previous one
let _currentAudio: HTMLAudioElement | null = null;

function handleAudioPlay(audio: HTMLAudioElement) {
  if (_currentAudio && _currentAudio !== audio && !_currentAudio.paused) {
    _currentAudio.pause();
  }
  _currentAudio = audio;
}

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
    <div className="grid grid-cols-3 gap-2 max-h-[300px] overflow-y-auto pr-1">
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

// ── Shared: delete icon ───────────────────────────────────────────────────────

function DeleteIcon({
  onClick,
  title = "删除此项",
}: {
  onClick: (e: React.MouseEvent) => void;
  title?: string;
}) {
  return (
    <button
      className="absolute top-1 right-1 p-1 rounded bg-white/80 hover:bg-white shadow text-zinc-400 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
      title={title}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClick(e); }}
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
        <path d="M10 11v6" />
        <path d="M14 11v6" />
        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      </svg>
    </button>
  );
}

// ── Images ────────────────────────────────────────────────────────────────────

export function ImageArtifacts({
  result,
  projectId,
  onDeleteItem,
}: {
  result: ImageResult;
  projectId: string;
  onDeleteItem?: (shot_id: string) => void;
}) {
  if (!result.images?.length) return null;

  return (
      <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
      {result.images.map((img) => (
        <div
          key={img.filename}
          className="relative aspect-video bg-zinc-100 rounded overflow-hidden group"
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
          {onDeleteItem && (
            <DeleteIcon onClick={() => onDeleteItem(img.shot_id)} />
          )}
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
  onDeleteItem,
}: {
  result: TTSResult;
  projectId: string;
  onDeleteItem?: (shot_id: string) => void;
}) {
  if (!result.audio_files?.length) return null;

  return (
    <div className="grid grid-cols-3 gap-2 max-h-[260px] overflow-y-auto pr-1">
      {result.audio_files.map((filename) => {
        const { shotId, trackType } = parseAudioFilename(filename);
        const trackLabel = getTrackLabel(trackType);

        return (
          <div key={filename} className="relative bg-zinc-50 rounded p-3 group">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-medium text-zinc-700">
                {shotId} · {trackLabel}
              </p>
              {onDeleteItem && (
                <button
                  className="p-1 rounded text-zinc-400 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                  title="删除此项"
                  onClick={() => onDeleteItem(shotId)}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6" />
                    <path d="M14 11v6" />
                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                  </svg>
                </button>
              )}
            </div>
            <audio
              controls
              src={`/api/projects/${projectId}/files/audio/${filename}`}
              className="w-full h-8"
              onPlay={(e) => handleAudioPlay(e.currentTarget)}
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
  onDeleteItem,
}: {
  result: VideoResult;
  projectId: string;
  onDeleteItem?: (shot_id: string) => void;
}) {
  if (!result.clips?.length) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {result.clips.map((clip) => (
        <div
          key={clip.filename}
          className="relative bg-zinc-50 rounded overflow-hidden group"
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
          {onDeleteItem && (
            <DeleteIcon onClick={() => onDeleteItem(clip.shot_id)} />
          )}
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

// ── Progress view (执行中实时产物) ────────────────────────────────────────────

function ProgressArtifactsView({
  step,
  artifacts,
  projectId,
}: {
  step: StepName;
  artifacts: ProgressArtifact[];
  projectId: string;
}) {
  const done = artifacts.filter((a) => !a.skipped);
  if (!done.length) return null;

  if (step === "image") {
    return (
    <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
        {done.map((a) => {
          const filename = a.filename ?? `${a.shot_id}.png`;
          return (
            <div key={a.shot_id} className="relative aspect-video bg-zinc-100 rounded overflow-hidden">
              <img
                src={`/api/projects/${projectId}/files/images/${filename}`}
                alt={a.shot_id}
                loading="lazy"
                className="w-full h-full object-cover"
              />
              <span className="absolute bottom-1 left-1 text-xs bg-black/60 text-white px-1.5 py-0.5 rounded">
                {a.shot_id}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  if (step === "tts") {
    return (
      <div className="grid grid-cols-3 gap-2 max-h-[260px] overflow-y-auto pr-1">
        {done.map((a, i) => {
          const filename = a.filename ?? `${a.shot_id}_action.mp3`;
          const trackLabel = filename.includes("dialogue") ? "旁白" : "台词";
          return (
            <div key={i} className="bg-zinc-50 rounded p-3">
              <p className="text-sm font-medium text-zinc-700 mb-1">
                {a.shot_id} · {trackLabel}
              </p>
              <audio
                controls
                src={`/api/projects/${projectId}/files/audio/${filename}`}
                className="w-full h-8"
                onPlay={(e) => handleAudioPlay(e.currentTarget)}
              />
            </div>
          );
        })}
      </div>
    );
  }

  if (step === "video") {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {done.map((a) => {
          const filename = a.filename ?? `${a.shot_id}.mp4`;
          return (
            <div key={a.shot_id} className="bg-zinc-50 rounded overflow-hidden">
              <video
                controls
                preload="metadata"
                src={`/api/projects/${projectId}/files/clips/${filename}`}
                className="w-full rounded"
              />
              <div className="px-3 py-2">
                <span className="text-sm font-medium text-zinc-700">{a.shot_id}</span>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // storyboard / assembly: 显示已生成数量
  return (
    <p className="text-sm text-zinc-500">已生成 {done.length} 项...</p>
  );
}

// ── Router ────────────────────────────────────────────────────────────────────

export function StepArtifacts({
  step,
  result,
  projectId,
  progressArtifacts,
  onDeleteItem,
}: {
  step: StepName;
  result?: StepResult | null;
  projectId: string;
  progressArtifacts?: ProgressArtifact[];
  onDeleteItem?: (shot_id: string) => void;
}) {
  // 完成状态：使用持久化的 result
  if (result) {
    switch (result.type) {
      case "storyboard":
        return <StoryboardArtifacts projectId={projectId} />;
      case "image":
        return <ImageArtifacts result={result.data} projectId={projectId} onDeleteItem={onDeleteItem} />;
      case "tts":
        return <TTSArtifacts result={result.data} projectId={projectId} onDeleteItem={onDeleteItem} />;
      case "video":
        return <VideoArtifacts result={result.data} projectId={projectId} onDeleteItem={onDeleteItem} />;
      case "assembly":
        return <AssemblyArtifacts result={result.data} projectId={projectId} />;
      default:
        return null;
    }
  }

  // 执行中：使用实时 progressArtifacts
  if (progressArtifacts?.length) {
    return (
      <ProgressArtifactsView
        step={step}
        artifacts={progressArtifacts}
        projectId={projectId}
      />
    );
  }

  return null;
}
