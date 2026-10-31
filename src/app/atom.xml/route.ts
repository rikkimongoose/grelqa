import { feedResponse } from "@/feeds/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET() {
  return feedResponse("atom");
}
