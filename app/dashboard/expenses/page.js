import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { evaluateSessionAccess, getDashboardRedirect } from "../../../lib/access_control.js";
import { getAuthOptions } from "../../../lib/auth.js";
import { getSessionWithE2EBypass } from "../../../lib/e2e_auth_bypass.js";
import { getAllowedEmails } from "../../../lib/allowed_emails.js";
import { logAccessDenied } from "../../../lib/access_log.js";
import ExpensesExplorer from "./expenses-explorer.js";

export const dynamic = "force-dynamic";

export default async function ExpensesPage() {
  const session = await getSessionWithE2EBypass(() => getServerSession(getAuthOptions()));
  const access = evaluateSessionAccess(session, getAllowedEmails());
  const redirectTo = getDashboardRedirect({ sessionStatus: access.status, usingTokenFallback: false });

  if (redirectTo) {
    logAccessDenied({ reason: access.status, email: access.email, path: "/dashboard/expenses" });
    redirect(redirectTo);
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-6">
      <div className="rounded border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">Gastos</h1>
          <p className="text-slate-600">Consulta tus gastos con filtros y paginación.</p>
        </div>
      </div>
      <ExpensesExplorer />
    </main>
  );
}
