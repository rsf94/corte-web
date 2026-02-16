import { BigQuery } from "@google-cloud/bigquery";
import { getServerSession } from "next-auth";
import { getAuthOptions } from "../../../lib/auth.js";
import { logAccessDenied } from "../../../lib/access_log.js";
import { getAllowedEmails, isEmailAllowed } from "../../../lib/allowed_emails.js";
import { getMonthRange, normalizeMonthStart } from "../../../lib/months.js";

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

function parseMonthParam(value) {
  const normalized = normalizeMonthStart(value);
  if (!normalized) return null;
  return normalized;
}

function buildMonths(fromISO, toISO) {
  return getMonthRange(fromISO, toISO);
}

async function fetchExpenseAggregates({ chatId, fromISO, toISO }, queryFn = defaultQueryFn) {
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
     AND e.payment_method = b.card_name
     AND e.purchase_date BETWEEN b.start_date AND b.end_date
    WHERE e.is_msi IS FALSE OR e.is_msi IS NULL
    GROUP BY b.card_name, billing_month
  `;

  const [rows] = await queryFn({
    query,
    params: {
      chat_id: String(chatId),
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

function addToTotals(target, key, amount) {
  const current = target[key] ?? 0;
  target[key] = current + amount;
}

async function fetchLinkedChatIdByEmail(email, queryFn = defaultQueryFn) {
  const dataset = requiredEnv("BQ_DATASET");
  const query = `
    SELECT chat_id
    FROM \`${requiredEnv("BQ_PROJECT_ID")}.${dataset}.user_links\`
    WHERE email = @email AND status = "LINKED"
    ORDER BY linked_at DESC
    LIMIT 1
  `;

  const [rows] = await queryFn({
    query,
    params: { email: String(email) }
  });
  if (!rows.length) {
    return "";
  }
  return String(rows[0].chat_id || "");
}

export async function handleCashflowGet(
  request,
  {
    getSession = () => getServerSession(getAuthOptions()),
    queryFn = defaultQueryFn
  } = {}
) {
  try {
    const requestUrl = new URL(request.url);
    const { searchParams } = requestUrl;
    const session = await getSession();
    const allowedEmails = getAllowedEmails();
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    if (!allowedEmails.length) {
      logAccessDenied({
        reason: "missing_allowlist",
        email: session?.user?.email ?? "",
        path: requestUrl.pathname
      });
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!session) {
      logAccessDenied({
        reason: "missing_session",
        email: "",
        path: requestUrl.pathname
      });
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const email = session.user?.email ?? "";
    if (!isEmailAllowed(email)) {
      logAccessDenied({
        reason: "email_not_allowed",
        email,
        path: requestUrl.pathname
      });
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const chatId = await fetchLinkedChatIdByEmail(email, queryFn);
    if (!chatId) {
      return Response.json({ error: "Cuenta no vinculada" }, { status: 403 });
    }

    const fromISO = parseMonthParam(from);
    const toISO = parseMonthParam(to);

    if (!fromISO || !toISO) {
      return Response.json({ error: "Invalid from/to" }, { status: 400 });
    }

    const months = buildMonths(fromISO, toISO);
    const aggregates = await fetchExpenseAggregates({ chatId, fromISO, toISO }, queryFn);

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

    return Response.json({ months, rows, totals });
  } catch (error) {
    return Response.json({ error: error.message ?? "Server error" }, { status: 500 });
  }
}

export async function GET(request) {
  return handleCashflowGet(request);
}
