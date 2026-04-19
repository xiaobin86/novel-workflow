"use client";
import useSWR from "swr";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useProjectState(projectId: string) {
  const { data, error, mutate } = useSWR(
    `/api/projects/${projectId}/state`,
    fetcher,
    { refreshInterval: 5000 }
  );
  return { state: data, error, mutate };
}

export function useProjects() {
  const { data, error, mutate } = useSWR("/api/projects", fetcher);
  return { projects: data?.projects ?? [], error, mutate };
}
