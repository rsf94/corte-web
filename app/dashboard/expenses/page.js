import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { evaluateSessionAccess, getDashboardRedirect } from "../../../lib/access_control.js";
import { getAuthOptions } from "../../../lib/auth.js";
import { getAllowedEmails } from "../../../lib/allowed_emails.js";
import { logAccessDenied } from "../../../lib/access_log.js";
import ExpensesExplorer from "./expenses-explorer.js";

export const dynamic = "force-dynamic";

export default async function ExpensesPage() {
  const session = await getServerSession(getAuthOptions());
  const access = evaluateSessionAccess(session, getAllowedEmails());
  const redirectTo = getDashboardRedirect({ sessionStatus: access.status, usingTokenFallback: false });

  if (redirectTo) {
    logAccessDenied({ reason: access.status, email: access.email, path: "/dashboard/expenses" });
    redirect(redirectTo);
  }

  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Expenses Explorer</h1>
        <p className="text-slate-600">Consulta read-only de gastos con filtros y paginación.</p>
      </div>
      <ExpensesExplorer />
    </main>
  );
}
