"use client";

import { STEP_ORDER, STEP_LABELS, StepName } from "@/lib/services";

const STATUS_ICONS: Record<string, string> = {
  pending:     "○",
  in_progress: "◌",
  stopped:     "■",
  completed:   "✓",
  failed:      "✗",
};

const STATUS_COLORS: Record<string, string> = {
  pending:     "text-zinc-400",
  in_progress: "text-blue-500",
  stopped:     "text-orange-500",
  completed:   "text-green-600",
  failed:      "text-red-500",
};

const STATUS_LABELS: Record<string, string> = {
  pending:     "待执行",
  in_progress: "执行中",
  stopped:     "已停止",
  completed:   "已完成",
  failed:      "失败",
};

interface StepNavigatorProps {
  steps: Record<StepName, { status: string }>;
  activeStep: StepName;
  onStepClick: (step: StepName) => void;
}

export function StepNavigator({ steps, activeStep, onStepClick }: StepNavigatorProps) {
  return (
    <nav className="bg-white border rounded-lg p-4">
      <h3 className="text-sm font-medium text-zinc-500 mb-3">步骤导航</h3>
      <ul className="space-y-1">
        {STEP_ORDER.map((step, idx) => {
          const status = steps[step]?.status ?? "pending";
          const isActive = activeStep === step;
          return (
            <li key={step}>
              <button
                onClick={() => onStepClick(step)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors text-left ${
                  isActive
                    ? "bg-blue-50 text-blue-700 font-medium"
                    : "hover:bg-zinc-50 text-zinc-700"
                }`}
              >
                <span className={`w-4 text-center ${STATUS_COLORS[status]}`}>
                  {STATUS_ICONS[status]}
                </span>
                <span className="flex-1">
                  {idx + 1}. {STEP_LABELS[step]}
                </span>
                <span className="text-xs text-zinc-400">
                  {STATUS_LABELS[status]}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
