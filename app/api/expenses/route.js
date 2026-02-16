import { BigQuery } from "@google-cloud/bigquery";
import { getServerSession } from "next-auth";
import { getAuthOptions } from "../../../lib/auth.js";
import { resolveLatestLinkedChatIdByEmail } from "../../../lib/identity_links.js";

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
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
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

function normalizeRow(row) {
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
    created_at: row.created_at?.value ?? row.created_at ?? ""
  };
}

async function fetchExpenses({ chatId, filters, queryFn = defaultQueryFn }) {
  const dataset = requiredEnv("BQ_DATASET");
  const projectId = requiredEnv("BQ_PROJECT_ID");
  const expensesTable = `\`${projectId}.${dataset}.expenses\``;

  const conditions = ["chat_id = @chat_id"];
  const params = {
    chat_id: String(chatId),
    limit_plus_one: filters.limit + 1
  };

  if (filters.from) {
    conditions.push("purchase_date >= DATE(@from_date)");
    params.from_date = filters.from;
  }

  if (filters.to) {
    conditions.push("purchase_date <= DATE(@to_date)");
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
      purchase_date < DATE(@cursor_purchase_date)
      OR (purchase_date = DATE(@cursor_purchase_date) AND created_at < TIMESTAMP(@cursor_created_at))
      OR (
        purchase_date = DATE(@cursor_purchase_date)
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
      purchase_date,
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
    ORDER BY purchase_date DESC, created_at DESC, id DESC
    LIMIT @limit_plus_one
  `;

  const [rows] = await queryFn({ query, params });
  const normalized = rows.map(normalizeRow);
  const hasMore = normalized.length > filters.limit;
  const items = hasMore ? normalized.slice(0, filters.limit) : normalized;
  const nextCursor = hasMore ? encodeCursor(items[items.length - 1]) : null;

  return {
    items,
    next_cursor: nextCursor
  };
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

export async function handleExpensesGet(
  request,
  {
    getSession = () => getServerSession(getAuthOptions()),
    queryFn = defaultQueryFn
  } = {}
) {
  try {
    const requestUrl = new URL(request.url);
    const session = await getSession();

    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const email = session.user?.email ?? "";
    const chatId = await resolveLatestLinkedChatIdByEmail(email, { queryFn });
    if (!chatId) {
      return Response.json({ error: "Cuenta no vinculada" }, { status: 403 });
    }

    const filters = getFilterValues(requestUrl.searchParams);
    const data = await fetchExpenses({ chatId, filters, queryFn });

    return Response.json({ ok: true, ...data });
  } catch (error) {
    return Response.json({ error: error.message ?? "Server error" }, { status: 500 });
  }
}

export async function GET(request) {
  return handleExpensesGet(request);
}
