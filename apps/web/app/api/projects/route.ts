import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createProject, listProjects } from "@/lib/project-store";

export async function GET() {
  const projects = await listProjects();
  return NextResponse.json({ projects });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { title, episode = "E01", text } = body;

  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const id = randomUUID();
  const state = await createProject(id, title, episode, text);
  return NextResponse.json(state, { status: 201 });
}
