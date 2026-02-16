import { getServerSession } from "next-auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { evaluateSessionAccess, getDashboardRedirect } from "../../lib/access_control.js";
import { logAccessDenied } from "../../lib/access_log.js";
import { getAuthOptions } from "../../lib/auth.js";
import { handleDashboardLinkToken } from "../../lib/dashboard_link_handler.js";
import { getAllowedEmails } from "../../lib/allowed_emails.js";
import { startOfMonthISO } from "../../lib/date_utils.js";
import CashflowTable from "./cashflow-table.js";
import { consumeLinkTokenAppendOnly } from "../../lib/user_links.js";

export const dynamic = "force-dynamic";

export default async function Dashboard({ searchParams }) {
  const session = await getServerSession(getAuthOptions());
  const allowedEmails = getAllowedEmails();
  if (!allowedEmails.length) {
    logAccessDenied({ reason: "missing_allowlist", email: "", path: "/dashboard" });
    redirect("/unauthorized");
  }

  const access = evaluateSessionAccess(session, allowedEmails);
  const hasSession = access.status === "ok";

  const linkToken = searchParams.link_token ?? "";
  const requestId = headers().get("x-request-id") ?? "";
  const provider = session?.user?.provider || "google";
  const sessionState = {};
  const linkHandling = await handleDashboardLinkToken({
    linkToken,
    hasSession,
    email: access.email,
    provider,
    requestId,
    sessionState,
    consumeLinkToken: consumeLinkTokenAppendOnly
  });
  if (linkHandling.redirectTo) {
    redirect(linkHandling.redirectTo);
  }

  const redirectTo = getDashboardRedirect({
    sessionStatus: access.status,
    usingTokenFallback: false
  });
  if (redirectTo) {
    logAccessDenied({
      reason: access.status,
      email: access.email,
      path: "/dashboard"
    });
    redirect(redirectTo);
  }

  const fromParam = searchParams.from ?? "";
  const toParam = searchParams.to ?? "";
  const fromISO = fromParam ? startOfMonthISO(fromParam.length === 7 ? `${fromParam}-01` : fromParam) : "";
  const toISO = toParam ? startOfMonthISO(toParam.length === 7 ? `${toParam}-01` : toParam) : "";

  return (
    <main className="mx-auto max-w-6xl px-6 py-6">
      <div className="rounded border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">Pagos por tarjeta (por mes)</h1>
          <p className="text-slate-600">Vista mensual por tarjeta usando fechas de corte.</p>
          <a className="text-sm font-medium text-blue-700 hover:underline" href="/dashboard/expenses">Ver gastos</a>
        </div>
      </div>

      {linkHandling.error ? (
        <div className="mt-6 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {linkHandling.error}
        </div>
      ) : null}

      <div className="mt-6 rounded border border-slate-200 bg-white p-4 shadow-sm">
        <CashflowTable initialData={null} initialFromISO={fromISO} initialToISO={toISO} />
      </div>
    </main>
  );
}
