"use client";
import { useState } from "react";
import Link from "next/link";
import { useProjects } from "@/hooks/useProjectState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DeleteProjectDialog } from "@/components/delete-project-dialog";

const STATUS_COLORS: Record<string, string> = {
  pending:     "bg-zinc-100 text-zinc-600",
  in_progress: "bg-blue-100 text-blue-700",
  completed:   "bg-green-100 text-green-700",
  failed:      "bg-red-100 text-red-700",
};

function projectOverallStatus(steps: Record<string, string>) {
  const vals = Object.values(steps);
  if (vals.every((s) => s === "completed")) return "completed";
  if (vals.some((s) => s === "failed"))     return "failed";
  if (vals.some((s) => s === "in_progress")) return "in_progress";
  return "pending";
}

function projectLabel(steps: Record<string, string>) {
  const s = projectOverallStatus(steps);
  const done = Object.values(steps).filter((v) => v === "completed").length;
  if (s === "completed") return "✓ 已完成";
  if (s === "in_progress") return `进行中 ${done}/5`;
  if (s === "failed") return "失败";
  return "未开始";
}

export default function ProjectsPage() {
  const { projects, mutate } = useProjects();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: "", episode: "E01", text: "" });

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      await mutate();
      setCreating(false);
      setForm({ title: "", episode: "E01", text: "" });
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="border-b bg-white px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Novel Workflow</h1>
        <Button onClick={() => setCreating(true)}>+ 新建项目</Button>
      </header>

      <main className="max-w-7xl mx-auto px-8 py-8">
        {creating && (
          <Card className="mb-8">
            <CardHeader><CardTitle>新建项目</CardTitle></CardHeader>
            <CardContent>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium">小说名</label>
                    <input
                      className="w-full mt-1 px-3 py-2 border rounded-md text-sm"
                      value={form.title}
                      onChange={(e) => setForm({ ...form, title: e.target.value })}
                      placeholder="斗破苍穹"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">集号</label>
                    <input
                      className="w-full mt-1 px-3 py-2 border rounded-md text-sm"
                      value={form.episode}
                      onChange={(e) => setForm({ ...form, episode: e.target.value })}
                      placeholder="E01"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium">小说文本（可选，也可在后续步骤中粘贴）</label>
                  <textarea
                    className="w-full mt-1 px-3 py-2 border rounded-md text-sm h-32 resize-none"
                    value={form.text}
                    onChange={(e) => setForm({ ...form, text: e.target.value })}
                    placeholder="粘贴小说原文..."
                  />
                </div>
                <div className="flex gap-2">
                  <Button type="submit">创建</Button>
                  <Button type="button" variant="outline" onClick={() => setCreating(false)}>取消</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {projects.length === 0 && !creating ? (
          <div className="text-center py-20 text-zinc-400">
            <p className="text-lg mb-4">还没有项目</p>
            <Button onClick={() => setCreating(true)}>创建第一个项目</Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((p: any) => {
              const status = projectOverallStatus(p.steps);
              return (
                <div key={p.id} className="relative group">
                  <Link href={`/projects/${p.id}`}>
                    <Card className="cursor-pointer hover:shadow-md transition-shadow">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">{p.title}</CardTitle>
                        <p className="text-sm text-zinc-500">{p.episode}</p>
                      </CardHeader>
                      <CardContent>
                        <Badge className={STATUS_COLORS[status]}>
                          {projectLabel(p.steps)}
                        </Badge>
                        <p className="text-xs text-zinc-400 mt-2">
                          {new Date(p.created_at).toLocaleDateString("zh-CN")}
                        </p>
                      </CardContent>
                    </Card>
                  </Link>
                  {/* Delete button — visible on hover */}
                  <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <DeleteProjectDialog
                      projectId={p.id}
                      projectTitle={`${p.title} — ${p.episode}`}
                      onDeleted={() => mutate()}
                      trigger={
                        <button
                          className="p-1.5 rounded bg-white shadow border text-zinc-400 hover:text-red-500 hover:border-red-200 transition-colors"
                          title="删除项目"
                          onClick={(e) => e.preventDefault()}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                            <path d="M10 11v6M14 11v6" />
                            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                          </svg>
                        </button>
                      }
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
