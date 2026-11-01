import { requireVerifiedUser } from "@/auth/session";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export default async function ManageLayout({ children }: { children: React.ReactNode }) { await requireVerifiedUser(); return children; }
