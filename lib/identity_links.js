import { BigQuery } from "@google-cloud/bigquery";
import crypto from "node:crypto";
import { normalizeEmail } from "./allowed_emails.js";

const bq = new BigQuery({
  projectId: process.env.BQ_PROJECT_ID || undefined
});

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env ${name}`);
  }
  return value;
}

function getIdentityTables() {
  const dataset = requiredEnv("BQ_DATASET");
  const project = requiredEnv("BQ_PROJECT_ID");
  const usersTable = process.env.BQ_IDENTITY_USERS_TABLE || "users";
  const chatLinksTable = process.env.BQ_IDENTITY_CHAT_LINKS_TABLE || "chat_links";
  return {
    users: `\`${project}.${dataset}.${usersTable}\``,
    chatLinks: `\`${project}.${dataset}.${chatLinksTable}\``
  };
}

function isMissingIdentityTableError(error) {
  const message = String(error?.message || "");
  if (!/not found/i.test(message)) return false;
  return /\.users|\.chat_links|users\b|chat_links\b/i.test(message);
}

function wrapIdentityError(error) {
  if (isMissingIdentityTableError(error)) {
    throw new Error("Missing BigQuery identity tables (users/chat_links). Run migrations under docs/migrations.");
  }
  throw error;
}

export async function ensureUserExistsByEmail(email, { queryFn, userIdFactory } = {}) {
  const normalizedEmail = normalizeEmail(email || "");
  if (!normalizedEmail) {
    return { email: "", userId: "" };
  }

  const runQuery = queryFn ?? ((options) => bq.query(options));
  const { users } = getIdentityTables();

  try {
    const lookupQuery = `
      SELECT user_id
      FROM ${users}
      WHERE email = @email
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const [rows] = await runQuery({ query: lookupQuery, params: { email: normalizedEmail } });
    if (rows.length > 0 && rows[0].user_id) {
      return { email: normalizedEmail, userId: String(rows[0].user_id) };
    }

    const newUserId = String(userIdFactory?.() ?? crypto.randomUUID());
    const insertQuery = `
      INSERT INTO ${users}
        (user_id, email, created_at, metadata)
      VALUES (@user_id, @email, CURRENT_TIMESTAMP(), CAST(NULL AS JSON))
    `;
    await runQuery({
      query: insertQuery,
      params: {
        user_id: newUserId,
        email: normalizedEmail
      }
    });

    return { email: normalizedEmail, userId: newUserId };
  } catch (error) {
    wrapIdentityError(error);
  }
}

export async function fetchLatestLinkedChatIdByUserId(userId, { queryFn } = {}) {
  return resolveChatIdForUser(userId, { queryFn });
}

export async function resolveChatIdForUser(userId, { queryFn } = {}) {
  if (!userId) return "";
  const runQuery = queryFn ?? ((options) => bq.query(options));
  const { chatLinks } = getIdentityTables();

  try {
    const query = `
      SELECT chat_id
      FROM ${chatLinks}
      WHERE user_id = @user_id
        AND (status IS NULL OR UPPER(status) IN ("LINKED", "ACTIVE"))
        AND chat_id IS NOT NULL
        AND TRIM(CAST(chat_id AS STRING)) != ""
      ORDER BY COALESCE(last_seen_at, created_at) DESC
      LIMIT 1
    `;
    const [rows] = await runQuery({ query, params: { user_id: String(userId) } });
    if (!rows.length) return "";
    return String(rows[0].chat_id || "");
  } catch (error) {
    wrapIdentityError(error);
  }
}

export async function resolveLatestLinkedChatIdByEmail(email, { queryFn } = {}) {
  const ensured = await ensureUserExistsByEmail(email, { queryFn });
  if (!ensured.userId) return "";
  return fetchLatestLinkedChatIdByUserId(ensured.userId, { queryFn });
}

export async function insertChatLink({ chatId, userId, provider = "google", metadata = null }, { queryFn } = {}) {
  const runQuery = queryFn ?? ((options) => bq.query(options));
  const { chatLinks } = getIdentityTables();
  const hasMetadata = metadata !== null && metadata !== undefined;

  try {
    const query = `
      INSERT INTO ${chatLinks}
        (chat_id, user_id, provider, status, created_at, last_seen_at, metadata)
      VALUES (@chat_id, @user_id, @provider, "LINKED", CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP(), ${
        hasMetadata ? "@metadata" : "CAST(NULL AS JSON)"
      })
    `;
    const params = {
      chat_id: String(chatId),
      user_id: String(userId),
      provider: String(provider || "google")
    };
    if (hasMetadata) {
      params.metadata = metadata;
    }
    await runQuery({ query, params });
  } catch (error) {
    wrapIdentityError(error);
  }
}
