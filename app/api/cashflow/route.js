import { BigQuery } from "@google-cloud/bigquery";
import { getServerSession } from "next-auth";
import { getAuthOptions } from "../../../lib/auth.js";
import { logAccessDenied } from "../../../lib/access_log.js";
import { getAllowedEmails, isEmailAllowed } from "../../../lib/allowed_emails.js";
import { getCashflowMonthForPurchase } from "../../../lib/cashflow.js";
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

async function fetchCardRules(chatId, queryFn = defaultQueryFn) {
  const dataset = requiredEnv("BQ_DATASET");
  const query = `
    SELECT card_name, cut_day, pay_offset_days, roll_weekend_to_monday
    FROM \`${requiredEnv("BQ_PROJECT_ID")}.${dataset}.card_rules\`
    WHERE chat_id = @chat_id AND active = true
    ORDER BY card_name
  `;

  const [rows] = await queryFn({
    query,
    params: { chat_id: String(chatId) }
  });

  return rows.map((row) => ({
    card_name: row.card_name,
    cut_day: Number(row.cut_day),
    pay_offset_days: Number(row.pay_offset_days || 0),
    roll_weekend_to_monday: Boolean(row.roll_weekend_to_monday)
  }));
}

async function fetchNoMsiAggregates({ chatId, fromISO, toISO }, queryFn = defaultQueryFn) {
  const dataset = requiredEnv("BQ_DATASET");
  const query = `
    SELECT payment_method AS card_name, purchase_date, SUM(amount_mxn) AS total
    FROM \`${requiredEnv("BQ_PROJECT_ID")}.${dataset}.${requiredEnv("BQ_TABLE")}\`
    WHERE chat_id = @chat_id
      AND (is_msi IS NULL OR is_msi = false)
      AND purchase_date BETWEEN DATE(@from_date) AND DATE(@to_date)
    GROUP BY card_name, purchase_date
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
    purchase_date: row.purchase_date.value ?? row.purchase_date,
    total: Number(row.total || 0)
  }));
}

async function fetchMsiAggregates({ chatId, fromISO, toISO }, queryFn = defaultQueryFn) {
  const dataset = requiredEnv("BQ_DATASET");
  const query = `
    SELECT card_name, billing_month, SUM(amount_mxn) AS total
    FROM \`${requiredEnv("BQ_PROJECT_ID")}.${dataset}.installments\`
    WHERE chat_id = @chat_id
      AND billing_month BETWEEN DATE(@from_date) AND DATE(@to_date)
    GROUP BY card_name, billing_month
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
    billing_month: row.billing_month.value ?? row.billing_month,
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
    const [cardRules, noMsiRows, msiRows] = await Promise.all([
      fetchCardRules(chatId, queryFn),
      fetchNoMsiAggregates({ chatId, fromISO, toISO }, queryFn),
      fetchMsiAggregates({ chatId, fromISO, toISO }, queryFn)
    ]);

    const rowsByCard = new Map();
    cardRules.forEach((rule) => {
      rowsByCard.set(rule.card_name, { card_name: rule.card_name, totals: {} });
    });

    const cardRuleMap = new Map();
    cardRules.forEach((rule) => cardRuleMap.set(rule.card_name, rule));

    noMsiRows.forEach((row) => {
      const rule = cardRuleMap.get(row.card_name);
      if (!rule) return;
      const cashflowMonth = getCashflowMonthForPurchase({
        purchaseDateISO: row.purchase_date,
        cutDay: rule.cut_day,
        payOffsetDays: rule.pay_offset_days,
        rollWeekendToMonday: rule.roll_weekend_to_monday
      });
      const ym = cashflowMonth.slice(0, 7);
      const entry = rowsByCard.get(row.card_name);
      addToTotals(entry.totals, ym, row.total);
    });

    msiRows.forEach((row) => {
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
