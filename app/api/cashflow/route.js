import { BigQuery } from "@google-cloud/bigquery";
import crypto from "node:crypto";
import { getServerSession } from "next-auth";
import { getAuthOptions } from "../../../lib/auth.js";
import { fetchLatestLinkedChatIdByUserId } from "../../../lib/identity_links.js";
import { logAccessDenied } from "../../../lib/access_log.js";
import { getAllowedEmails, isEmailAllowed, normalizeEmail } from "../../../lib/allowed_emails.js";
import { getMonthRange, normalizeMonthStart } from "../../../lib/months.js";
import { getAuthedUserContext } from "../../../lib/auth_user_context.js";

export const dynamic = "force-dynamic";

const bq = new BigQuery({
  projectId: process.env.BQ_PROJECT_ID || undefined
});
const defaultQueryFn = (options) => bq.query(options);

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env ${name}`);
  }
  return value;
}

function shouldUseLegacyFallback() {
  return String(process.env.ENABLE_LEGACY_CHAT_FALLBACK || "").toLowerCase() === "true";
}

function parseMonthParam(value) {
  const normalized = normalizeMonthStart(value);
  if (!normalized) return null;
  return normalized;
}

function buildMonths(fromISO, toISO) {
  return getMonthRange(fromISO, toISO);
}

async function fetchExpenseAggregatesByUser({ userId, fromISO, toISO }, queryFn = defaultQueryFn) {
  const dataset = requiredEnv("BQ_DATASET");
  const projectId = requiredEnv("BQ_PROJECT_ID");
  const expensesTable = `\`${projectId}.${dataset}.${requiredEnv("BQ_TABLE")}\``;
  const cardRulesTable = `\`${projectId}.${dataset}.card_rules\``;

  const query = `
    WITH statement_months AS (
      SELECT statement_month
      FROM UNNEST(
        GENERATE_DATE_ARRAY(DATE(@from_date), DATE(@to_date), INTERVAL 1 MONTH)
      ) AS statement_month
    ),
    rules AS (
      SELECT card_name, cut_day, billing_shift_months
      FROM ${cardRulesTable}
      WHERE user_id = @user_id
        AND active = TRUE
    ),
    rule_windows AS (
      SELECT
        sm.statement_month,
        r.card_name,
        DATE_ADD(sm.statement_month, INTERVAL r.billing_shift_months MONTH) AS end_month_start,
        DATE_SUB(
          DATE_ADD(sm.statement_month, INTERVAL r.billing_shift_months MONTH),
          INTERVAL 1 MONTH
        ) AS start_month_start,
        r.cut_day
      FROM statement_months sm
      CROSS JOIN rules r
    ),
    bounds AS (
      SELECT
        statement_month,
        card_name,
        DATE(
          EXTRACT(YEAR FROM start_month_start),
          EXTRACT(MONTH FROM start_month_start),
          LEAST(
            cut_day,
            EXTRACT(DAY FROM DATE_SUB(DATE_ADD(start_month_start, INTERVAL 1 MONTH), INTERVAL 1 DAY))
          )
        ) AS start_date,
        DATE(
          EXTRACT(YEAR FROM end_month_start),
          EXTRACT(MONTH FROM end_month_start),
          LEAST(
            cut_day,
            EXTRACT(DAY FROM DATE_SUB(DATE_ADD(end_month_start, INTERVAL 1 MONTH), INTERVAL 1 DAY))
          )
        ) AS end_date
      FROM rule_windows
    )
    SELECT
      b.card_name,
      b.statement_month AS billing_month,
      SUM(e.amount_mxn) AS total
    FROM bounds b
    JOIN ${expensesTable} e
      ON e.user_id = @user_id
     AND e.payment_method = b.card_name
     AND e.purchase_date BETWEEN b.start_date AND b.end_date
    WHERE e.is_msi IS FALSE OR e.is_msi IS NULL
    GROUP BY b.card_name, billing_month
  `;

  const [rows] = await queryFn({
    query,
    params: {
      user_id: String(userId),
      from_date: fromISO,
      to_date: toISO
    }
  });

  return rows.map((row) => ({
    card_name: row.card_name,
    billing_month: row.billing_month?.value ?? row.billing_month,
    total: Number(row.total || 0)
  }));
}

async function fetchExpenseAggregatesLegacy({ userId, fromISO, toISO, linkedChatId = "" }, queryFn = defaultQueryFn) {
  const chatId = linkedChatId || (await fetchLatestLinkedChatIdByUserId(userId, { queryFn }));
  if (!chatId) return [];

  const dataset = requiredEnv("BQ_DATASET");
  const projectId = requiredEnv("BQ_PROJECT_ID");
  const expensesTable = `\`${projectId}.${dataset}.${requiredEnv("BQ_TABLE")}\``;
  const cardRulesTable = `\`${projectId}.${dataset}.card_rules\``;

  const query = `
    WITH statement_months AS (
      SELECT statement_month
      FROM UNNEST(
        GENERATE_DATE_ARRAY(DATE(@from_date), DATE(@to_date), INTERVAL 1 MONTH)
      ) AS statement_month
    ),
    rules AS (
      SELECT card_name, cut_day, billing_shift_months
      FROM ${cardRulesTable}
      WHERE chat_id = @chat_id
        AND active = TRUE
    ),
    rule_windows AS (
      SELECT
        sm.statement_month,
        r.card_name,
        DATE_ADD(sm.statement_month, INTERVAL r.billing_shift_months MONTH) AS end_month_start,
        DATE_SUB(
          DATE_ADD(sm.statement_month, INTERVAL r.billing_shift_months MONTH),
          INTERVAL 1 MONTH
        ) AS start_month_start,
        r.cut_day
      FROM statement_months sm
      CROSS JOIN rules r
    ),
    bounds AS (
      SELECT
        statement_month,
        card_name,
        DATE(
          EXTRACT(YEAR FROM start_month_start),
          EXTRACT(MONTH FROM start_month_start),
          LEAST(
            cut_day,
            EXTRACT(DAY FROM DATE_SUB(DATE_ADD(start_month_start, INTERVAL 1 MONTH), INTERVAL 1 DAY))
          )
        ) AS start_date,
        DATE(
          EXTRACT(YEAR FROM end_month_start),
          EXTRACT(MONTH FROM end_month_start),
          LEAST(
            cut_day,
            EXTRACT(DAY FROM DATE_SUB(DATE_ADD(end_month_start, INTERVAL 1 MONTH), INTERVAL 1 DAY))
          )
        ) AS end_date
      FROM rule_windows
    )
    SELECT
      b.card_name,
      b.statement_month AS billing_month,
      SUM(e.amount_mxn) AS total
    FROM bounds b
    JOIN ${expensesTable} e
      ON e.chat_id = @chat_id
     AND e.user_id IS NULL
     AND e.payment_method = b.card_name
     AND e.purchase_date BETWEEN b.start_date AND b.end_date
    WHERE e.is_msi IS FALSE OR e.is_msi IS NULL
    GROUP BY b.card_name, billing_month
  `;

  const [rows] = await queryFn({ query, params: { chat_id: String(chatId), from_date: fromISO, to_date: toISO } });
  return rows.map((row) => ({
    card_name: row.card_name,
    billing_month: row.billing_month?.value ?? row.billing_month,
    total: Number(row.total || 0)
  }));
}

function addToTotals(target, key, amount) {
  const current = target[key] ?? 0;
  target[key] = current + amount;
}

async function fetchExpenseAggregatesWithoutRules({ userId, fromISO, toISO }, queryFn = defaultQueryFn) {
  const dataset = requiredEnv("BQ_DATASET");
  const projectId = requiredEnv("BQ_PROJECT_ID");
  const expensesTable = `\`${projectId}.${dataset}.${requiredEnv("BQ_TABLE")}\``;

  const query = `
    SELECT
      COALESCE(NULLIF(TRIM(e.payment_method), ""), "Sin método") AS card_name,
      DATE_TRUNC(e.purchase_date, MONTH) AS billing_month,
      SUM(e.amount_mxn) AS total
    FROM ${expensesTable} e
    WHERE e.user_id = @user_id
      AND e.purchase_date BETWEEN DATE(@from_date) AND DATE(@to_date)
      AND (e.is_msi IS FALSE OR e.is_msi IS NULL)
    GROUP BY card_name, billing_month
  `;

  const [rows] = await queryFn({
    query,
    params: {
      user_id: String(userId),
      from_date: fromISO,
      to_date: toISO
    }
  });

  return rows.map((row) => ({
    card_name: row.card_name,
    billing_month: row.billing_month?.value ?? row.billing_month,
    total: Number(row.total || 0)
  }));
}

function getBigQueryErrorDetails(error) {
  return {
    name: error?.name || "Error",
    message: String(error?.message || ""),
    code: error?.code || null,
    reason: error?.errors?.[0]?.reason || null,
    partial_failure_count: Array.isArray(error?.errors) ? error.errors.length : 0
  };
}

function logCashflowError(errorPayload) {
  console.error(JSON.stringify({ type: "cashflow_error", ...errorPayload }));
}

export async function handleCashflowGet(
  request,
  {
    getSession = () => getServerSession(getAuthOptions()),
    queryFn = defaultQueryFn
  } = {}
) {
  const requestUrl = new URL(request.url);
  const { searchParams } = requestUrl;
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const requestId = request.headers.get("x-request-id") || crypto.randomUUID?.() || "";
  let hasSession = false;
  let email = "";
  let userId = "";
  let chatId = "";

  try {
    const allowedEmails = getAllowedEmails();

    if (!allowedEmails.length) {
      logAccessDenied({ reason: "missing_allowlist", email: "", path: requestUrl.pathname });
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const session = await getSession();
    if (!session) {
      logAccessDenied({ reason: "missing_session", email: "", path: requestUrl.pathname });
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    hasSession = true;

    email = normalizeEmail(session.user?.email ?? "");
    if (!isEmailAllowed(email)) {
      logAccessDenied({ reason: "email_not_allowed", email, path: requestUrl.pathname });
      return Response.json({ error: "Tu cuenta no está autorizada. Solicita acceso." }, { status: 403 });
    }

    const authContext = await getAuthedUserContext(request, { getSession: async () => session, queryFn });
    if (authContext.errorResponse) return authContext.errorResponse;
    userId = String(authContext.user_id || "");

    const fromISO = parseMonthParam(from);
    const toISO = parseMonthParam(to);

    if (!fromISO || !toISO) {
      return Response.json({ error: "Invalid from/to" }, { status: 400 });
    }

    const months = buildMonths(fromISO, toISO);
    let aggregates = await fetchExpenseAggregatesByUser({ userId: authContext.user_id, fromISO, toISO }, queryFn);

    if (!aggregates.length) {
      aggregates = await fetchExpenseAggregatesWithoutRules({ userId: authContext.user_id, fromISO, toISO }, queryFn);
    }

    if (!aggregates.length && shouldUseLegacyFallback()) {
      chatId = await fetchLatestLinkedChatIdByUserId(authContext.user_id, { queryFn });
      if (chatId) {
        aggregates = await fetchExpenseAggregatesLegacy({ userId: authContext.user_id, fromISO, toISO, linkedChatId: chatId }, queryFn);
      }
    }

    const rowsByCard = new Map();
    aggregates.forEach((row) => {
      const ym = String(row.billing_month).slice(0, 7);
      const entry = rowsByCard.get(row.card_name) ?? {
        card_name: row.card_name,
        totals: {}
      };
      addToTotals(entry.totals, ym, row.total);
      rowsByCard.set(row.card_name, entry);
    });

    const totals = {};
    months.forEach((month) => {
      totals[month] = 0;
    });

    const rows = Array.from(rowsByCard.values());
    rows.forEach((row) => {
      months.forEach((month) => {
        const value = row.totals[month] ?? 0;
        totals[month] += value;
      });
    });

    return Response.json({ ok: true, months, rows, totals });
  } catch (error) {
    logCashflowError({
      request_id: requestId,
      has_session: hasSession,
      email,
      user_id: userId || undefined,
      chat_id: chatId || undefined,
      from,
      to,
      bigquery: getBigQueryErrorDetails(error)
    });
    return Response.json({ ok: false, error: "Internal" }, { status: 500 });
  }
}

export async function GET(request) {
  return handleCashflowGet(request);
}
