import assert from "node:assert/strict";
import test from "node:test";

const envKeys = [
  "ALLOWED_EMAILS",
  "AUTH_ALLOWED_EMAILS",
  "BQ_PROJECT_ID",
  "BQ_DATASET",
  "BQ_TABLE",
  "ENABLE_LEGACY_CHAT_FALLBACK"
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

function identityResolverQuery(query, { chatId = "", userId = "user-1" } = {}) {
  if (query.includes(".users")) return [[{ user_id: userId }]];
  if (query.includes(".chat_links")) return [chatId ? [{ chat_id: chatId }] : []];
  return null;
}

test("cashflow route returns 401 when there is no authenticated session", async () => {
  const restore = withEnv({
    AUTH_ALLOWED_EMAILS: "user@example.com",
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

test("cashflow route usa user_id en query principal", async () => {
  const restore = withEnv({
    AUTH_ALLOWED_EMAILS: "user@example.com",
    BQ_PROJECT_ID: "project",
    BQ_DATASET: "dataset",
    BQ_TABLE: "expenses"
  });

  const paramsUsed = [];

  try {
    const { handleCashflowGet } = await import("../app/api/cashflow/route.js");
    const req = new Request("http://localhost:3000/api/cashflow?chat_id=ignored&from=2024-01-01&to=2024-02-01");

    const response = await handleCashflowGet(req, {
      getSession: async () => ({ user: { email: "user@example.com" } }),
      queryFn: async ({ query, params }) => {
        const resolved = identityResolverQuery(query, { userId: "user-123" });
        if (resolved) return resolved;

        paramsUsed.push(params);
        assert.match(query, /e\.user_id = @user_id/);
        assert.doesNotMatch(query, /e\.chat_id = @chat_id/);
        return [[]];
      }
    });

    assert.equal(response.status, 200);
    assert.equal(paramsUsed[0].user_id, "user-123");
  } finally {
    restore();
  }
});

test("cashflow route always excludes MSI rows", async () => {
  const restore = withEnv({
    AUTH_ALLOWED_EMAILS: "user@example.com",
    BQ_PROJECT_ID: "project",
    BQ_DATASET: "dataset",
    BQ_TABLE: "expenses"
  });

  let aggregateQuery = "";

  try {
    const { handleCashflowGet } = await import("../app/api/cashflow/route.js");
    const req = new Request(
      "http://localhost:3000/api/cashflow?from=2024-01-01&to=2024-02-01&exclude_msi=false"
    );

    const response = await handleCashflowGet(req, {
      getSession: async () => ({ user: { email: "user@example.com" } }),
      queryFn: async ({ query }) => {
        const resolved = identityResolverQuery(query, { userId: "user-123" });
        if (resolved) return resolved;

        aggregateQuery = query;
        return [[{ card_name: "BBVA", billing_month: "2024-01-01", total: 100 }]];
      }
    });

    assert.equal(response.status, 200);
    assert.match(aggregateQuery, /WHERE e\.is_msi IS FALSE OR e\.is_msi IS NULL/);

    const body = await response.json();
    assert.equal(body.rows[0].totals["2024-01"], 100);
  } finally {
    restore();
  }
});

test("cashflow route fallback legacy usa chat_links cuando está habilitado", async () => {
  const restore = withEnv({
    AUTH_ALLOWED_EMAILS: "user@example.com",
    BQ_PROJECT_ID: "project",
    BQ_DATASET: "dataset",
    BQ_TABLE: "expenses",
    ENABLE_LEGACY_CHAT_FALLBACK: "true"
  });

  try {
    const { handleCashflowGet } = await import("../app/api/cashflow/route.js");
    const req = new Request("http://localhost:3000/api/cashflow?from=2024-01-01&to=2024-01-01");
    const seenQueries = [];

    const response = await handleCashflowGet(req, {
      getSession: async () => ({ user: { email: "user@example.com" } }),
      queryFn: async ({ query, params }) => {
        seenQueries.push({ query, params });
        const resolved = identityResolverQuery(query, { userId: "user-123", chatId: "chat-123" });
        if (resolved) return resolved;
        if (query.includes("e.user_id = @user_id")) return [[]];
        if (query.includes("e.chat_id = @chat_id") && query.includes("e.user_id IS NULL")) {
          return [[{ card_name: "BBVA", billing_month: "2024-01-01", total: 50 }]];
        }
        return [[]];
      }
    });

    assert.equal(response.status, 200);
    assert.ok(seenQueries.some((entry) => entry.query.includes("FROM `project.dataset.chat_links`")));
    assert.ok(seenQueries.some((entry) => entry.query.includes("e.chat_id = @chat_id") && entry.query.includes("e.user_id IS NULL")));
  } finally {
    restore();
  }
});

test("cashflow route con fallback legacy deshabilitado no truena si no hay chat linked", async () => {
  const restore = withEnv({
    AUTH_ALLOWED_EMAILS: "user@example.com",
    BQ_PROJECT_ID: "project",
    BQ_DATASET: "dataset",
    BQ_TABLE: "expenses",
    ENABLE_LEGACY_CHAT_FALLBACK: "false"
  });

  try {
    const { handleCashflowGet } = await import("../app/api/cashflow/route.js");
    const req = new Request("http://localhost:3000/api/cashflow?from=2024-01-01&to=2024-01-01");
    const seenQueries = [];

    const response = await handleCashflowGet(req, {
      getSession: async () => ({ user: { email: "user@example.com" } }),
      queryFn: async ({ query, params }) => {
        seenQueries.push({ query, params });
        const resolved = identityResolverQuery(query, { userId: "user-123", chatId: "" });
        if (resolved) return resolved;
        return [[]];
      }
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.deepEqual(body.rows, []);
    assert.ok(!seenQueries.some((entry) => entry.query.includes("FROM `project.dataset.chat_links`")));
  } finally {
    restore();
  }
});

test("cashflow route captura errores de BigQuery y loguea cashflow_error estructurado", async () => {
  const restore = withEnv({
    AUTH_ALLOWED_EMAILS: "user@example.com",
    BQ_PROJECT_ID: "project",
    BQ_DATASET: "dataset",
    BQ_TABLE: "expenses"
  });

  const logs = [];
  const originalError = console.error;
  console.error = (...args) => {
    logs.push(args.join(" "));
  };

  try {
    const { handleCashflowGet } = await import("../app/api/cashflow/route.js");
    const req = new Request("http://localhost:3000/api/cashflow?from=2024-01-01&to=2024-02-01", {
      headers: { "x-request-id": "req-123" }
    });

    const response = await handleCashflowGet(req, {
      getSession: async () => ({ user: { email: "USER@example.com" } }),
      queryFn: async ({ query, params }) => {
        if (params) {
          for (const value of Object.values(params)) {
            assert.notEqual(value, null);
            assert.notEqual(value, undefined);
          }
        }

        const resolved = identityResolverQuery(query, { userId: "user-123" });
        if (resolved) return resolved;

        const error = new Error("Parameter types must be provided for null values");
        error.name = "PartialFailureError";
        error.errors = [{ reason: "invalidQuery" }];
        error.code = 400;
        throw error;
      }
    });

    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { ok: false, error: "Internal" });

    assert.equal(logs.length, 1);
    const payload = JSON.parse(logs[0]);
    assert.equal(payload.type, "cashflow_error");
    assert.equal(payload.request_id, "req-123");
    assert.equal(payload.has_session, true);
    assert.equal(payload.email, "user@example.com");
    assert.equal(payload.user_id, "user-123");
    assert.equal(payload.from, "2024-01-01");
    assert.equal(payload.to, "2024-02-01");
    assert.equal(payload.bigquery.name, "PartialFailureError");
  } finally {
    console.error = originalError;
    restore();
  }
});
