import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { PROJECTS_BASE_DIR } from "@/lib/services";

const MIME: Record<string, string> = {
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".mp4":  "video/mp4",
  ".mp3":  "audio/mpeg",
  ".srt":  "text/plain",
  ".json": "application/json",
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; path: string[] }> }
) {
  const { id, path: segments } = await params;
  const filePath = path.join(PROJECTS_BASE_DIR, id, ...segments);

  // Security: ensure path stays within project dir
  const base = path.join(PROJECTS_BASE_DIR, id);
  if (!filePath.startsWith(base)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) throw new Error("not a file");
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] ?? "application/octet-stream";
  const isDownload = req.nextUrl.searchParams.get("download") === "1";

  const stream = fs.createReadStream(filePath);
  const headers: Record<string, string> = { "Content-Type": contentType };
  if (isDownload) {
    headers["Content-Disposition"] = `attachment; filename="${path.basename(filePath)}"`;
  }

  return new Response(stream as unknown as ReadableStream, { headers });
}
