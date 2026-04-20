"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

interface Props {
  projectId: string;
  projectTitle: string;
  trigger: React.ReactNode;
  /** Called after successful deletion instead of router.push (e.g. to refresh list in-place) */
  onDeleted?: () => void;
}

export function DeleteProjectDialog({ projectId, projectTitle, trigger, onDeleted }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
      if (res.status === 204) {
        setOpen(false);
        if (onDeleted) {
          onDeleted();
        } else {
          router.push("/projects");
          router.refresh();
        }
        return;
      }
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `删除失败（${res.status}）`);
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Trigger */}
      <span onClick={() => { setOpen(true); setError(null); }}>
        {trigger}
      </span>

      {/* Backdrop + Dialog */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={(e) => { if (e.target === e.currentTarget && !loading) setOpen(false); }}
        >
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6 space-y-4">
            <h2 className="text-lg font-semibold">删除项目</h2>
            <p className="text-sm text-zinc-600">
              确定要删除{" "}
              <span className="font-semibold text-zinc-900">「{projectTitle}」</span>
              {" "}吗？
            </p>
            <p className="text-sm text-zinc-500">
              此操作将删除所有生成内容，包括分镜、图片、音频和视频文件，且<span className="text-red-600 font-medium">不可恢复</span>。
            </p>

            {error && (
              <p className="text-sm text-red-500 bg-red-50 border border-red-200 rounded px-3 py-2">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <Button
                variant="outline"
                disabled={loading}
                onClick={() => setOpen(false)}
              >
                取消
              </Button>
              <Button
                variant="destructive"
                disabled={loading}
                onClick={handleDelete}
              >
                {loading ? "删除中..." : "确认删除"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
