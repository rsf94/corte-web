import { BigQuery } from "@google-cloud/bigquery";
import crypto from "node:crypto";

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

function datasetTable() {
  const dataset = requiredEnv("BQ_DATASET");
  const project = requiredEnv("BQ_PROJECT_ID");
  return `\`${project}.${dataset}.user_links\``;
}

export async function upsertUserLink({ email, chatId }) {
  const table = datasetTable();
  const query = `
    MERGE ${table} AS target
    USING (SELECT @email AS email, @chat_id AS chat_id) AS source
    ON target.email = source.email AND target.chat_id = source.chat_id
    WHEN MATCHED THEN
      UPDATE SET
        status = "ACTIVE",
        linked_at = IFNULL(target.linked_at, CURRENT_TIMESTAMP()),
        last_seen_at = CURRENT_TIMESTAMP()
    WHEN NOT MATCHED THEN
      INSERT (email, chat_id, status, linked_at, last_seen_at)
      VALUES (source.email, source.chat_id, "ACTIVE", CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())
  `;

  await bq.query({
    query,
    params: {
      email: String(email),
      chat_id: String(chatId)
    }
  });
}

function buildTokenPreview(token) {
  if (!token) return "";
  if (token.length <= 12) return `${token.slice(0, 4)}...`;
  return `${token.slice(0, 8)}...${token.slice(-4)}`;
}

function signTokenPart(part, secret) {
  return crypto.createHmac("sha256", secret).update(part).digest("base64url");
}

function timingSafeEqualString(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function isValidLinkTokenHmac(linkToken, { secret } = {}) {
  if (!linkToken) return false;
  const resolvedSecret = secret ?? requiredEnv("LINK_TOKEN_SECRET");
  const parts = String(linkToken).split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
  const [randomPart, signature] = parts;
  const expectedSignature = signTokenPart(randomPart, resolvedSecret);
  return timingSafeEqualString(signature, expectedSignature);
}

export async function consumeLinkTokenAppendOnly(
  linkToken,
  email,
  provider,
  { requestId = "", queryFn, logger = console.log, secret } = {}
) {
  const tokenPreview = buildTokenPreview(String(linkToken || ""));
  const safeLog = ({ bqMs, result }) => {
    logger(
      JSON.stringify({
        type: "link_consume",
        request_id: requestId,
        email: String(email || ""),
        provider: String(provider || ""),
        token_preview: tokenPreview,
        bq_ms: bqMs,
        result
      })
    );
  };

  if (!isValidLinkTokenHmac(linkToken, { secret })) {
    safeLog({ bqMs: 0, result: "invalid_token" });
    return { ok: false, error: "invalid_or_expired" };
  }

  const runQuery = queryFn ?? ((options) => bq.query(options));
  const table = datasetTable();
  const queryParams = {
    linkToken: String(linkToken),
    email: String(email),
    provider: String(provider)
  };
  const startedAt = Date.now();

  const reuseQuery = `
    SELECT 1
    FROM ${table}
    WHERE link_token = @linkToken AND status = "LINKED"
    LIMIT 1
  `;
  const [reusedRows] = await runQuery({ query: reuseQuery, params: queryParams });
  if (reusedRows.length > 0) {
    safeLog({ bqMs: Date.now() - startedAt, result: "already_used" });
    return { ok: false, error: "already_used" };
  }

  const insertQuery = `
    INSERT INTO ${table}
      (link_token, chat_id, email, provider, status, created_at, linked_at, expires_at, last_seen_at, metadata)
    SELECT
      link_token,
      chat_id,
      @email,
      @provider,
      "LINKED",
      CURRENT_TIMESTAMP(),
      CURRENT_TIMESTAMP(),
      expires_at,
      CURRENT_TIMESTAMP(),
      metadata
    FROM ${table}
    WHERE link_token = @linkToken
      AND status = "PENDING"
      AND (expires_at IS NULL OR expires_at >= CURRENT_TIMESTAMP())
      AND NOT EXISTS (
        SELECT 1 FROM ${table}
        WHERE link_token = @linkToken AND status = "LINKED"
        LIMIT 1
      )
    LIMIT 1
  `;
  await runQuery({ query: insertQuery, params: queryParams });

  const verifyQuery = `
    SELECT chat_id
    FROM ${table}
    WHERE link_token = @linkToken AND status = "LINKED"
    ORDER BY linked_at DESC
    LIMIT 1
  `;
  const [linkedRows] = await runQuery({ query: verifyQuery, params: queryParams });
  const linkedRow = linkedRows[0];
  if (!linkedRow?.chat_id) {
    safeLog({ bqMs: Date.now() - startedAt, result: "not_found_or_expired" });
    return { ok: false, error: "expired_or_missing_or_consumed" };
  }

  safeLog({ bqMs: Date.now() - startedAt, result: "linked" });
  return { ok: true, chatId: String(linkedRow.chat_id) };
}

export function buildFetchActiveLinksByEmailQuery(table) {
  return `
    SELECT email, chat_id, status, linked_at, last_seen_at
    FROM ${table}
    WHERE email = @email AND status = "ACTIVE"
    ORDER BY last_seen_at DESC, linked_at DESC
  `;
}

export async function fetchActiveLinksByEmail(email) {
  const table = datasetTable();
  const query = buildFetchActiveLinksByEmailQuery(table);

  const [rows] = await bq.query({
    query,
    params: { email: String(email) }
  });

  return rows.map((row) => ({
    email: row.email,
    chat_id: String(row.chat_id),
    status: row.status,
    linked_at: row.linked_at?.value ?? row.linked_at,
    last_seen_at: row.last_seen_at?.value ?? row.last_seen_at
  }));
}

export async function fetchLatestLinkedChatIdByEmail(email, { queryFn } = {}) {
  const table = datasetTable();
  const query = `
    SELECT chat_id
    FROM ${table}
    WHERE email = @email AND status = "LINKED"
    ORDER BY linked_at DESC
    LIMIT 1
  `;
  const runQuery = queryFn ?? ((options) => bq.query(options));
  const [rows] = await runQuery({
    query,
    params: { email: String(email) }
  });
  if (!rows.length) return "";
  return String(rows[0].chat_id || "");
}

export async function touchUserLink({ email, chatId }) {
  const table = datasetTable();
  const query = `
    UPDATE ${table}
    SET last_seen_at = CURRENT_TIMESTAMP()
    WHERE email = @email AND chat_id = @chat_id AND status = "ACTIVE"
  `;

  await bq.query({
    query,
    params: { email: String(email), chat_id: String(chatId) }
  });
}
