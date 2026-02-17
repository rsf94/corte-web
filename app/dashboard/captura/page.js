import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { getAuthOptions } from "../../../lib/auth.js";
import { getAllowedEmails, isEmailAllowed, normalizeEmail } from "../../../lib/allowed_emails.js";
import { logAccessDenied } from "../../../lib/access_log.js";
import CapturaChat from "./captura-chat.js";

export const dynamic = "force-dynamic";

export default async function DashboardCapturaPage() {
  const allowed = getAllowedEmails();

  if (!allowed.length) {
    logAccessDenied({ reason: "missing_allowlist", email: "", path: "/dashboard/captura" });
    redirect("/unauthorized");
  }

  const session = await getServerSession(getAuthOptions());

  if (!session) {
    redirect("/login");
  }

  const sessionEmail = normalizeEmail(session.user?.email ?? "");

  if (!isEmailAllowed(sessionEmail, allowed)) {
    logAccessDenied({ reason: "email_not_allowed", email: sessionEmail, path: "/dashboard/captura" });
    redirect("/unauthorized");
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-8">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">Captura</h1>
        <p className="text-sm text-slate-600">Registra tus gastos como en Telegram, pero desde web.</p>
      </section>
      <div className="mt-6">
        <CapturaChat />
      </div>
    </main>
  );
}
