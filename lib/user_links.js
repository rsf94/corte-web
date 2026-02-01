import { BigQuery } from "@google-cloud/bigquery";

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
        last_used_at = CURRENT_TIMESTAMP()
    WHEN NOT MATCHED THEN
      INSERT (email, chat_id, status, linked_at, last_used_at)
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

export async function fetchActiveLinksByEmail(email) {
  const table = datasetTable();
  const query = `
    SELECT email, chat_id, status, linked_at, last_used_at
    FROM ${table}
    WHERE email = @email AND status = "ACTIVE"
    ORDER BY last_used_at DESC, linked_at DESC
  `;

  const [rows] = await bq.query({
    query,
    params: { email: String(email) }
  });

  return rows.map((row) => ({
    email: row.email,
    chat_id: String(row.chat_id),
    status: row.status,
    linked_at: row.linked_at?.value ?? row.linked_at,
    last_used_at: row.last_used_at?.value ?? row.last_used_at
  }));
}

export async function touchUserLink({ email, chatId }) {
  const table = datasetTable();
  const query = `
    UPDATE ${table}
    SET last_used_at = CURRENT_TIMESTAMP()
    WHERE email = @email AND chat_id = @chat_id AND status = "ACTIVE"
  `;

  await bq.query({
    query,
    params: { email: String(email), chat_id: String(chatId) }
  });
}
