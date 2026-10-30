import { requireVerifiedUser } from "@/auth/session";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata = { robots: { index: false, follow: false } };
export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  await requireVerifiedUser();
  return children;
}
