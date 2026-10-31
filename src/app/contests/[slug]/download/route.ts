import { attachmentHeader, downloadArchive } from "@/exports/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const group = new URL(request.url).searchParams.get("group") ?? undefined;
  try {
    const archive = await downloadArchive(slug, group);
    if (!archive) return new Response("Нет доступных для скачивания рассказов. Вернитесь к списку конкурса.", { status: 404, headers });
    return new Response(new Uint8Array(archive.bytes), { headers: { ...headers,
      "Content-Type": "application/zip", "Content-Disposition": attachmentHeader(archive.filename),
      "Content-Length": String(archive.bytes.length),
    } });
  } catch {
    return new Response("Не удалось подготовить архив. Попробуйте скачать его позднее.", { status: 503, headers });
  }
}
