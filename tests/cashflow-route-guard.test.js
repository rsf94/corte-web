import assert from "node:assert/strict";
import test from "node:test";

const envKeys = [
  "ALLOWED_EMAILS",
  "BQ_PROJECT_ID",
  "BQ_DATASET",
  "BQ_TABLE"
];

function withEnv(overrides) {
  const original = {};
  for (const key of envKeys) {
    original[key] = process.env[key];
  }
  for (const [key, value] of Object.entries(overrides)) {
    process.env[key] = value;
  }

  return () => {
    for (const key of envKeys) {
      if (original[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original[key];
      }
    }
  };
}

test("cashflow route returns 401 when there is no authenticated session", async () => {
  const restore = withEnv({
    ALLOWED_EMAILS: "user@example.com",
    BQ_PROJECT_ID: "project",
    BQ_DATASET: "dataset",
    BQ_TABLE: "expenses"
  });

  try {
    const { handleCashflowGet } = await import("../app/api/cashflow/route.js");
    const req = new Request("http://localhost:3000/api/cashflow?from=2024-01-01&to=2024-02-01");

    const response = await handleCashflowGet(req, {
      getSession: async () => null,
      queryFn: async () => {
        throw new Error("BigQuery should not be called when there is no session");
      }
    });

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Unauthorized" });
  } finally {
    restore();
  }
});

test("cashflow route returns 403 when session exists but has no LINKED chat", async () => {
  const restore = withEnv({
    ALLOWED_EMAILS: "user@example.com",
    BQ_PROJECT_ID: "project",
    BQ_DATASET: "dataset",
    BQ_TABLE: "expenses"
  });

  try {
    const { handleCashflowGet } = await import("../app/api/cashflow/route.js");
    const req = new Request("http://localhost:3000/api/cashflow?from=2024-01-01&to=2024-02-01");

    const response = await handleCashflowGet(req, {
      getSession: async () => ({ user: { email: "user@example.com" } }),
      queryFn: async ({ query }) => {
        assert.match(query, /user_links/);
        return [[]];
      }
    });

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "Cuenta no vinculada" });
  } finally {
    restore();
  }
});

test("cashflow route uses LINKED chat_id from user_links for BigQuery cashflow queries", async () => {
  const restore = withEnv({
    ALLOWED_EMAILS: "user@example.com",
    BQ_PROJECT_ID: "project",
    BQ_DATASET: "dataset",
    BQ_TABLE: "expenses"
  });

  const linkedChatId = "linked-chat-123";
  const chatIdsUsed = [];

  try {
    const { handleCashflowGet } = await import("../app/api/cashflow/route.js");
    const req = new Request(
      "http://localhost:3000/api/cashflow?chat_id=should-be-ignored&from=2024-01-01&to=2024-02-01"
    );

    const response = await handleCashflowGet(req, {
      getSession: async () => ({ user: { email: "user@example.com" } }),
      queryFn: async ({ query, params }) => {
        if (query.includes("user_links")) {
          return [[{ chat_id: linkedChatId }]];
        }

        if (Object.prototype.hasOwnProperty.call(params ?? {}, "chat_id")) {
          chatIdsUsed.push(params.chat_id);
        }

        return [[]];
      }
    });

    assert.equal(response.status, 200);
    assert.deepEqual(chatIdsUsed, [linkedChatId, linkedChatId, linkedChatId]);
  } finally {
    restore();
  }
});
