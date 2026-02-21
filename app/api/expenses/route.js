import { BigQuery } from "@google-cloud/bigquery";
import { getServerSession } from "next-auth";
import crypto from "node:crypto";
import { getAuthOptions } from "../../../lib/auth.js";
import { fetchLatestLinkedChatIdByUserId } from "../../../lib/identity_links.js";
import { getAuthedUserContext } from "../../../lib/auth_user_context.js";
import { convertToMxn } from "../../../lib/fx/frankfurter.js";
import { normalizeExpensePayloadWithCore } from "../../../lib/finclaro_core_bridge.js";

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

function parseISODate(value) {
  if (!value) return "";
  const normalized = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;

  const dmyMatch = normalized.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!dmyMatch) return "";

  const [, day, month, year] = dmyMatch;
  return `${year}-${month}-${day}`;
}

function parseIsMsi(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function parseLimit(value) {
  const parsed = Number.parseInt(value ?? "50", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 50;
  return Math.min(parsed, 200);
}

function shouldUseLegacyFallback() {
  return String(process.env.ENABLE_LEGACY_CHAT_FALLBACK || "").toLowerCase() === "true";
}

function normalizeCurrency(value = "") {
  const normalized = String(value || "MXN").trim().toUpperCase();
  return normalized || "MXN";
}

function normalizeRow(row, source = "web_user") {
  return {
    id: String(row.id ?? ""),
    purchase_date: row.purchase_date?.value ?? row.purchase_date ?? "",
    payment_method: row.payment_method ?? "",
    category: row.category ?? "",
    merchant: row.merchant ?? "",
    description: row.description ?? "",
    raw_text: row.raw_text ?? "",
    amount_mxn: Number(row.amount_mxn ?? 0),
    is_msi: Boolean(row.is_msi ?? false),
    msi_months: row.msi_months === null || row.msi_months === undefined ? null : Number(row.msi_months),
    created_at: row.created_at?.value ?? row.created_at ?? "",
    source
  };
}

export function encodeCursor(row) {
  const payload = {
    purchase_date: row.purchase_date,
    created_at: row.created_at,
    id: String(row.id)
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeCursor(cursor) {
  if (!cursor) return null;

  try {
    const json = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = JSON.parse(json);
    if (!parseISODate(parsed.purchase_date) || !parsed.created_at || parsed.id === undefined) {
      return null;
    }
    return {
      purchase_date: parsed.purchase_date,
      created_at: String(parsed.created_at),
      id: String(parsed.id)
    };
  } catch {
    return null;
  }
}

async function fetchExpensesByUserId({ userId, filters, queryFn = defaultQueryFn }) {
  const dataset = requiredEnv("BQ_DATASET");
  const projectId = requiredEnv("BQ_PROJECT_ID");
  const expensesTable = `\`${projectId}.${dataset}.expenses\``;

  const conditions = ["user_id = @user_id"];
  const params = {
    user_id: String(userId),
    limit_plus_one: filters.limit + 1
  };

  if (filters.from) {
    conditions.push("DATE(purchase_date) >= DATE(@from_date)");
    params.from_date = filters.from;
  }

  if (filters.to) {
    conditions.push("DATE(purchase_date) <= DATE(@to_date)");
    params.to_date = filters.to;
  }

  if (filters.paymentMethod) {
    conditions.push("payment_method = @payment_method");
    params.payment_method = filters.paymentMethod;
  }

  if (filters.category) {
    conditions.push("category = @category");
    params.category = filters.category;
  }

  if (filters.q) {
    conditions.push(`(
      LOWER(COALESCE(merchant, "")) LIKE @q_like
      OR LOWER(COALESCE(description, "")) LIKE @q_like
      OR LOWER(COALESCE(raw_text, "")) LIKE @q_like
    )`);
    params.q_like = `%${filters.q.toLowerCase()}%`;
  }

  if (filters.isMsi !== null) {
    conditions.push("IFNULL(is_msi, FALSE) = @is_msi");
    params.is_msi = filters.isMsi;
  }

  if (filters.cursor) {
    conditions.push(`(
      DATE(purchase_date) < DATE(@cursor_purchase_date)
      OR (DATE(purchase_date) = DATE(@cursor_purchase_date) AND created_at < TIMESTAMP(@cursor_created_at))
      OR (
        DATE(purchase_date) = DATE(@cursor_purchase_date)
        AND created_at = TIMESTAMP(@cursor_created_at)
        AND CAST(id AS STRING) < @cursor_id
      )
    )`);
    params.cursor_purchase_date = filters.cursor.purchase_date;
    params.cursor_created_at = filters.cursor.created_at;
    params.cursor_id = filters.cursor.id;
  }

  const query = `
    SELECT
      id,
      DATE(purchase_date) AS purchase_date,
      payment_method,
      category,
      merchant,
      description,
      raw_text,
      amount_mxn,
      is_msi,
      msi_months,
      created_at
    FROM ${expensesTable}
    WHERE ${conditions.join("\n      AND ")}
    ORDER BY DATE(purchase_date) DESC, created_at DESC, id DESC
    LIMIT @limit_plus_one
  `;

  const [rows] = await queryFn({ query, params });
  return rows.map((row) => normalizeRow(row, "web_user"));
}

async function fetchLegacyExpenses({ userId, filters, queryFn = defaultQueryFn }) {
  const chatId = await fetchLatestLinkedChatIdByUserId(userId, { queryFn });
  if (!chatId) return [];

  const dataset = requiredEnv("BQ_DATASET");
  const projectId = requiredEnv("BQ_PROJECT_ID");
  const expensesTable = `\`${projectId}.${dataset}.expenses\``;

  const conditions = ["chat_id = @chat_id", "user_id IS NULL"];
  const params = {
    chat_id: chatId
  };

  if (filters.from) {
    conditions.push("DATE(purchase_date) >= DATE(@from_date)");
    params.from_date = filters.from;
  }
  if (filters.to) {
    conditions.push("DATE(purchase_date) <= DATE(@to_date)");
    params.to_date = filters.to;
  }
  if (filters.paymentMethod) {
    conditions.push("payment_method = @payment_method");
    params.payment_method = filters.paymentMethod;
  }
  if (filters.category) {
    conditions.push("category = @category");
    params.category = filters.category;
  }
  if (filters.q) {
    conditions.push(`(
      LOWER(COALESCE(merchant, "")) LIKE @q_like
      OR LOWER(COALESCE(description, "")) LIKE @q_like
      OR LOWER(COALESCE(raw_text, "")) LIKE @q_like
    )`);
    params.q_like = `%${filters.q.toLowerCase()}%`;
  }
  if (filters.isMsi !== null) {
    conditions.push("IFNULL(is_msi, FALSE) = @is_msi");
    params.is_msi = filters.isMsi;
  }

  const query = `
    SELECT
      id,
      DATE(purchase_date) AS purchase_date,
      payment_method,
      category,
      merchant,
      description,
      raw_text,
      amount_mxn,
      is_msi,
      msi_months,
      created_at
    FROM ${expensesTable}
    WHERE ${conditions.join("\n      AND ")}
    ORDER BY DATE(purchase_date) DESC, created_at DESC, id DESC
  `;

  const [rows] = await queryFn({ query, params });
  return rows.map((row) => normalizeRow(row, "legacy_chat"));
}

function getFilterValues(searchParams) {
  const from = parseISODate(searchParams.get("from") || "");
  const to = parseISODate(searchParams.get("to") || "");
  const paymentMethod = (searchParams.get("payment_method") || "").trim();
  const category = (searchParams.get("category") || "").trim();
  const q = (searchParams.get("q") || "").trim();
  const isMsi = parseIsMsi(searchParams.get("is_msi"));
  const limit = parseLimit(searchParams.get("limit"));
  const cursor = decodeCursor(searchParams.get("cursor") || "");

  return { from, to, paymentMethod, category, q, isMsi, limit, cursor };
}

function validateExpensePayload(payload = {}) {
  const purchaseDate = parseISODate(payload.purchase_date);
  const amount = Number(payload.amount);
  const paymentMethod = String(payload.payment_method || "").trim();
  const category = String(payload.category || "").trim();

  if (!purchaseDate) return "purchase_date inválida";
  if (!Number.isFinite(amount) || amount <= 0) return "amount inválido";
  if (!paymentMethod) return "payment_method requerido";
  if (!category) return "category requerida";
  if (payload.msi_months !== undefined && payload.msi_months !== null) {
    const months = Number.parseInt(String(payload.msi_months), 10);
    if (!Number.isFinite(months) || months < 1) return "msi_months inválido";
  }

  return "";
}

export async function handleExpensesGet(
  request,
  {
    getSession = () => getServerSession(getAuthOptions()),
    queryFn = defaultQueryFn
  } = {}
) {
  try {
    const requestUrl = new URL(request.url);
    const authContext = await getAuthedUserContext(request, { getSession, queryFn });
    if (authContext.errorResponse) return authContext.errorResponse;

    const filters = getFilterValues(requestUrl.searchParams);
    const primary = await fetchExpensesByUserId({ userId: authContext.user_id, filters, queryFn });

    let normalized = primary;
    if (!normalized.length && shouldUseLegacyFallback()) {
      normalized = await fetchLegacyExpenses({ userId: authContext.user_id, filters, queryFn });
    }

    normalized.sort((a, b) => {
      if (a.purchase_date !== b.purchase_date) return a.purchase_date < b.purchase_date ? 1 : -1;
      if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
      return String(a.id).localeCompare(String(b.id)) * -1;
    });

    const hasMore = normalized.length > filters.limit;
    const items = hasMore ? normalized.slice(0, filters.limit) : normalized;
    const nextCursor = hasMore ? encodeCursor(items[items.length - 1]) : null;

    if (!items.length) {
      return Response.json({ ok: true, items: [], next_cursor: null, empty_reason: "no_data" });
    }

    return Response.json({ ok: true, items, next_cursor: nextCursor });
  } catch (error) {
    return Response.json({ error: error.message ?? "Server error" }, { status: 500 });
  }
}

export async function handleExpensesPost(
  request,
  {
    getSession = () => getServerSession(getAuthOptions()),
    queryFn = defaultQueryFn,
    fxConverter = convertToMxn,
    uuidFactory = () => crypto.randomUUID(),
    normalizePayloadWithCore = normalizeExpensePayloadWithCore
  } = {}
) {
  try {
    const authContext = await getAuthedUserContext(request, { getSession, queryFn });
    if (authContext.errorResponse) return authContext.errorResponse;

    const payload = await request.json();
    const coreNormalized = await normalizePayloadWithCore(payload);
    const sourcePayload = coreNormalized && typeof coreNormalized === "object"
      ? {
          ...payload,
          ...coreNormalized,
          purchase_date: coreNormalized.purchase_date ?? coreNormalized.purchaseDate ?? payload.purchase_date,
          amount: coreNormalized.amount ?? coreNormalized.original_amount ?? coreNormalized.originalAmount ?? payload.amount,
          currency: coreNormalized.currency ?? coreNormalized.original_currency ?? coreNormalized.originalCurrency ?? payload.currency,
          payment_method: coreNormalized.payment_method ?? coreNormalized.paymentMethod ?? payload.payment_method,
          category: coreNormalized.category ?? payload.category,
          merchant: coreNormalized.merchant ?? payload.merchant,
          description: coreNormalized.description ?? payload.description,
          is_msi: coreNormalized.is_msi ?? coreNormalized.isMsi ?? payload.is_msi,
          msi_months: coreNormalized.msi_months ?? coreNormalized.msiMonths ?? payload.msi_months,
          trip_id: coreNormalized.trip_id ?? coreNormalized.tripId ?? payload.trip_id
        }
      : payload;

    const validationError = validateExpensePayload(sourcePayload);
    if (validationError) {
      return Response.json({ error: validationError }, { status: 400 });
    }

    const dataset = requiredEnv("BQ_DATASET");
    const projectId = requiredEnv("BQ_PROJECT_ID");
    const expensesTable = `\`${projectId}.${dataset}.expenses\``;

    const currency = normalizeCurrency(sourcePayload.currency);
    const amount = Number(sourcePayload.amount);
    const purchaseDate = parseISODate(sourcePayload.purchase_date);
    const isMsi = Boolean(sourcePayload.is_msi ?? false);
    const msiMonths = sourcePayload.msi_months === undefined || sourcePayload.msi_months === null
      ? null
      : Number.parseInt(String(sourcePayload.msi_months), 10);

    let amountMxn = amount;
    let amountMxnSource = "direct";
    let originalAmount = null;
    let originalCurrency = null;
    let fxRate = null;
    let fxProvider = null;
    let fxDate = null;

    if (currency !== "MXN") {
      const conversion = await fxConverter({ amount, baseCurrency: currency, quoteCurrency: "MXN", date: purchaseDate });
      amountMxn = Number((amount * conversion.rate).toFixed(2));
      amountMxnSource = "fx";
      originalAmount = amount;
      originalCurrency = currency;
      fxRate = conversion.rate;
      fxProvider = conversion.provider;
      fxDate = conversion.date;
    }

    const params = {
      id: uuidFactory(),
      purchase_date: purchaseDate,
      amount_mxn: amountMxn,
      currency,
      payment_method: String(sourcePayload.payment_method).trim(),
      category: String(sourcePayload.category).trim(),
      merchant: String(sourcePayload.merchant || "").trim() || null,
      description: String(sourcePayload.description || "").trim() || null,
      is_msi: isMsi,
      msi_months: msiMonths,
      trip_id: String(sourcePayload.trip_id || "").trim() || null,
      user_id: authContext.user_id,
      original_amount: originalAmount,
      original_currency: originalCurrency,
      fx_rate: fxRate,
      fx_provider: fxProvider,
      fx_date: fxDate,
      amount_mxn_source: amountMxnSource
    };

    const query = `
      INSERT INTO ${expensesTable}
      (id, purchase_date, amount_mxn, currency, payment_method, category, merchant, description, is_msi, msi_months, trip_id,
       user_id, chat_id, created_at, original_amount, original_currency, fx_rate, fx_provider, fx_date, amount_mxn_source)
      VALUES
      (@id, DATE(@purchase_date), @amount_mxn, @currency, @payment_method, @category, @merchant, @description, @is_msi, @msi_months, @trip_id,
       @user_id, NULL, CURRENT_TIMESTAMP(), @original_amount, @original_currency, @fx_rate, @fx_provider, @fx_date, @amount_mxn_source)
    `;

    await queryFn({ query, params });

    return Response.json({ ok: true, id: params.id });
  } catch (error) {
    return Response.json({ error: error.message ?? "Server error" }, { status: 500 });
  }
}

export async function GET(request) {
  return handleExpensesGet(request);
}

export async function POST(request) {
  return handleExpensesPost(request);
}
