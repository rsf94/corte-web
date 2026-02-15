import { getServerSession } from "next-auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { evaluateSessionAccess, getDashboardRedirect } from "../../lib/access_control.js";
import { logAccessDenied } from "../../lib/access_log.js";
import { getAuthOptions } from "../../lib/auth.js";
import { handleDashboardLinkToken } from "../../lib/dashboard_link_handler.js";
import { getAllowedEmails } from "../../lib/allowed_emails.js";
import { addMonthsISO, startOfMonthISO } from "../../lib/date_utils.js";
import { getMonthRange, monthToInputValue } from "../../lib/months.js";
import {
  consumeLinkTokenAppendOnly,
  fetchLatestLinkedChatIdByEmail,
  touchUserLink
} from "../../lib/user_links.js";

export const dynamic = "force-dynamic";

function currentMonthISO() {
  const now = new Date();
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 12, 0, 0));
  return base.toISOString().slice(0, 10);
}

function formatCurrency(value) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value || 0);
}

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

  const token = hasSession ? "" : (searchParams.token ?? "");
  const chatIdParam = searchParams.chat_id ?? "";
  const usingTokenFallback = !hasSession && token && chatIdParam && allowedEmails.length > 0;
  let chatId = chatIdParam || sessionState.chat_id || "";
  let linkLookupFailed = false;

  if (!chatId && hasSession) {
    try {
      chatId = await fetchLatestLinkedChatIdByEmail(access.email);
    } catch {
      linkLookupFailed = true;
    }
  }

  if (chatId && hasSession) {
    try {
      await touchUserLink({ email: access.email, chatId });
    } catch {
      // Non-blocking best-effort update.
    }
  }

  const redirectTo = getDashboardRedirect({
    sessionStatus: access.status,
    usingTokenFallback
  });
  if (redirectTo) {
    logAccessDenied({
      reason: access.status === "ok" ? "missing_session" : access.status,
      email: access.email,
      path: "/dashboard"
    });
    redirect(redirectTo);
  }

  const baseMonth = currentMonthISO();
  const defaultFrom = addMonthsISO(baseMonth, -5);
  const defaultTo = addMonthsISO(baseMonth, 6);

  const fromParam = searchParams.from ?? defaultFrom;
  const toParam = searchParams.to ?? defaultTo;
  const fromISO = startOfMonthISO(fromParam.length === 7 ? `${fromParam}-01` : fromParam);
  const toISO = startOfMonthISO(toParam.length === 7 ? `${toParam}-01` : toParam);

  const months = getMonthRange(fromISO, toISO);

  let data = null;
  let error = null;

  if (chatId && (hasSession || usingTokenFallback)) {
    const hdrs = headers();
    const host = hdrs.get("host");
    const proto = hdrs.get("x-forwarded-proto") ?? "http";
    const baseUrl = host ? `${proto}://${host}` : "";
    const apiUrl = new URL("/api/cashflow", baseUrl || "http://localhost:3000");
    if (usingTokenFallback) {
      apiUrl.searchParams.set("token", token);
    }
    apiUrl.searchParams.set("chat_id", chatId);
    apiUrl.searchParams.set("from", fromISO);
    apiUrl.searchParams.set("to", toISO);

    const res = await fetch(apiUrl.toString(), {
      cache: "no-store",
      headers: {
        cookie: hdrs.get("cookie") ?? ""
      }
    });
    if (res.ok) {
      data = await res.json();
    } else if (res.status === 401) {
      redirect("/login");
    } else if (res.status === 403) {
      redirect("/unauthorized");
    } else {
      const text = await res.text();
      error = text || `Error ${res.status}`;
    }
  }

  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Pagos TDC por mes</h1>
        <p className="text-slate-600">Vista read-only de cashflow mensual por tarjeta.</p>
      </div>

      <form className="mt-6 flex flex-wrap items-end gap-4" method="get">
        {!hasSession ? (
          <>
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="chat_id" value={chatId} />
          </>
        ) : (
          <input type="hidden" name="chat_id" value={chatId} />
        )}
        <label className="flex flex-col gap-1 text-sm">
          Desde
          <input
            className="rounded border border-slate-300 px-3 py-2"
            type="month"
            name="from"
            defaultValue={monthToInputValue(fromISO)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Hasta
          <input
            className="rounded border border-slate-300 px-3 py-2"
            type="month"
            name="to"
            defaultValue={monthToInputValue(toISO)}
          />
        </label>
        <button
          className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          type="submit"
        >
          Aplicar
        </button>
      </form>

      {linkHandling.error ? (
        <div className="mt-6 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {linkHandling.error}
        </div>
      ) : null}

      {!chatId && hasSession ? (
        <div className="mt-6 rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          No tienes tu cuenta vinculada. Pide <strong>/dashboard</strong> en Telegram.
          {linkLookupFailed ? (
            <p className="mt-2">No pudimos validar tus vínculos en este momento. Intenta de nuevo.</p>
          ) : null}
        </div>
      ) : null}

      {!chatId && !hasSession ? (
        <div className="mt-6 rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Agrega <strong>chat_id</strong> en la URL para ver el dashboard.
        </div>
      ) : null}

      {usingTokenFallback ? (
        <div className="mt-4 rounded border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          Estás usando acceso por token. Inicia sesión con Google para acceso directo.
        </div>
      ) : null}

      {error ? (
        <div className="mt-6 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {data ? (
        <div className="mt-6 overflow-x-auto rounded border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100 text-left">
              <tr>
                <th className="px-4 py-3">Tarjeta</th>
                {months.map((month) => (
                  <th key={month} className="px-4 py-3 text-right">
                    {month}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.card_name} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-medium">{row.card_name}</td>
                  {months.map((month) => (
                    <td key={month} className="px-4 py-3 text-right tabular-nums">
                      {formatCurrency(row.totals[month] ?? 0)}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="border-t border-slate-200 bg-slate-50 font-semibold">
                <td className="px-4 py-3">TOTAL</td>
                {months.map((month) => (
                  <td key={month} className="px-4 py-3 text-right tabular-nums">
                    {formatCurrency(data.totals[month] ?? 0)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}
    </main>
  );
}
