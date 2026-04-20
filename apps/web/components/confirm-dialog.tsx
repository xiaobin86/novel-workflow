"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  trigger: React.ReactNode;
  onConfirm: () => Promise<void>;
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel = "确认",
  trigger,
  onConfirm,
}: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setLoading(true);
    setError(null);
    try {
      await onConfirm();
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <span onClick={() => { setOpen(true); setError(null); }}>
        {trigger}
      </span>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={(e) => {
            if (e.target === e.currentTarget && !loading) setOpen(false);
          }}
        >
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6 space-y-4">
            <h2 className="text-lg font-semibold">{title}</h2>
            <div className="text-sm text-zinc-600">{description}</div>

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
                onClick={handleConfirm}
              >
                {loading ? "处理中..." : confirmLabel}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
