import assert from "node:assert/strict";
import test from "node:test";

const envKeys = ["BQ_PROJECT_ID", "BQ_DATASET", "ENABLE_LEGACY_CHAT_FALLBACK"];

function withEnv(overrides) {
  const original = {};
  for (const key of envKeys) original[key] = process.env[key];
  for (const [key, value] of Object.entries(overrides)) process.env[key] = value;

  return () => {
    for (const key of envKeys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  };
}

function identityResolverQuery(query, { chatId = "", userId = "user-1" } = {}) {
  if (query.includes(".users")) return [[{ user_id: userId }]];
  if (query.includes(".chat_links")) return [chatId ? [{ chat_id: chatId }] : []];
  return null;
}

test("expenses route returns 401 when there is no authenticated session", async () => {
  const restore = withEnv({ BQ_PROJECT_ID: "project", BQ_DATASET: "dataset" });

  try {
    const { handleExpensesGet } = await import("../app/api/expenses/route.js");
    const req = new Request("http://localhost:3000/api/expenses");

    const response = await handleExpensesGet(req, {
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

test("POST /api/expenses sin sesión retorna 401", async () => {
  const restore = withEnv({ BQ_PROJECT_ID: "project", BQ_DATASET: "dataset" });

  try {
    const { handleExpensesPost } = await import("../app/api/expenses/route.js");
    const req = new Request("http://localhost:3000/api/expenses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    });

    const response = await handleExpensesPost(req, {
      getSession: async () => null,
      queryFn: async () => {
        throw new Error("BigQuery should not be called");
      }
    });

    assert.equal(response.status, 401);
  } finally {
    restore();
  }
});

test("POST /api/expenses con sesión inserta con user_id y chat_id null", async () => {
  const restore = withEnv({ BQ_PROJECT_ID: "project", BQ_DATASET: "dataset" });
  let insertQuery = "";
  let insertParams = {};

  try {
    const { handleExpensesPost } = await import("../app/api/expenses/route.js");
    const req = new Request("http://localhost:3000/api/expenses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        purchase_date: "2024-06-10",
        amount: 123.45,
        payment_method: "AMEX",
        category: "Food"
      })
    });

    const response = await handleExpensesPost(req, {
      getSession: async () => ({ user: { email: "user@example.com" } }),
      queryFn: async ({ query, params }) => {
        const resolved = identityResolverQuery(query, { userId: "user-123" });
        if (resolved) return resolved;
        insertQuery = query;
        insertParams = params;
        return [[]];
      },
      uuidFactory: () => "uuid-1"
    });

    assert.equal(response.status, 200);
    assert.match(insertQuery, /chat_id, created_at/);
    assert.match(insertQuery, /@user_id, NULL, CURRENT_TIMESTAMP\(\)/);
    assert.equal(insertParams.user_id, "user-123");
    assert.equal(insertParams.amount_mxn_source, "direct");

    const body = await response.json();
    assert.deepEqual(body, { ok: true, id: "uuid-1" });
  } finally {
    restore();
  }
});

test("POST con currency != MXN usa fx client y llena campos FX", async () => {
  const restore = withEnv({ BQ_PROJECT_ID: "project", BQ_DATASET: "dataset" });
  let insertParams = {};

  try {
    const { handleExpensesPost } = await import("../app/api/expenses/route.js");
    const req = new Request("http://localhost:3000/api/expenses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        purchase_date: "2024-06-10",
        amount: 10,
        currency: "USD",
        payment_method: "AMEX",
        category: "Travel"
      })
    });

    const response = await handleExpensesPost(req, {
      getSession: async () => ({ user: { email: "user@example.com" } }),
      queryFn: async ({ query, params }) => {
        const resolved = identityResolverQuery(query, { userId: "user-123" });
        if (resolved) return resolved;
        insertParams = params;
        return [[]];
      },
      fxConverter: async () => ({ rate: 17.1, provider: "frankfurter", date: "2024-06-10" })
    });

    assert.equal(response.status, 200);
    assert.equal(insertParams.original_amount, 10);
    assert.equal(insertParams.original_currency, "USD");
    assert.equal(insertParams.fx_provider, "frankfurter");
    assert.equal(insertParams.fx_rate, 17.1);
    assert.equal(insertParams.amount_mxn_source, "fx");
    assert.equal(insertParams.amount_mxn, 171);
  } finally {
    restore();
  }
});

test("GET /api/expenses usa @user_id y no usa chat_id de querystring", async () => {
  const restore = withEnv({ BQ_PROJECT_ID: "project", BQ_DATASET: "dataset" });

  let expensesQuery = "";
  let expensesParams = {};

  try {
    const { handleExpensesGet, encodeCursor } = await import("../app/api/expenses/route.js");
    const cursor = encodeCursor({
      purchase_date: "2024-06-10",
      created_at: "2024-06-10T09:00:00.000Z",
      id: "abc-1"
    });

    const req = new Request(
      `http://localhost:3000/api/expenses?chat_id=ignored&from=2024-05-01&to=2024-06-30&payment_method=AMEX&category=Food&q=tacos&is_msi=false&limit=2&cursor=${cursor}`
    );

    const response = await handleExpensesGet(req, {
      getSession: async () => ({ user: { email: "user@example.com" } }),
      queryFn: async ({ query, params }) => {
        const resolved = identityResolverQuery(query, { userId: "user-xyz" });
        if (resolved) return resolved;
        expensesQuery = query;
        expensesParams = params;
        return [[
          {
            id: "3",
            purchase_date: "2024-06-09",
            created_at: "2024-06-09T10:00:00.000Z",
            payment_method: "AMEX",
            category: "Food",
            merchant: "Taqueria",
            description: "Comida",
            raw_text: "Taqueria comida",
            amount_mxn: 100,
            is_msi: false,
            msi_months: null
          }
        ]];
      }
    });

    assert.equal(response.status, 200);
    assert.match(expensesQuery, /user_id = @user_id/);
    assert.match(expensesQuery, /DATE\(purchase_date\) <= DATE\(@to_date\)/);
    assert.match(expensesQuery, /ORDER BY DATE\(purchase_date\) DESC, created_at DESC, id DESC/);
    assert.doesNotMatch(expensesQuery, /chat_id = @chat_id/);
    assert.equal(expensesParams.user_id, "user-xyz");
    assert.equal(expensesParams.to_date, "2024-06-30");
  } finally {
    restore();
  }
});

test("GET /api/expenses ordena por purchase_date DESC y created_at DESC como desempate", async () => {
  const restore = withEnv({ BQ_PROJECT_ID: "project", BQ_DATASET: "dataset" });

  try {
    const { handleExpensesGet } = await import("../app/api/expenses/route.js");
    const req = new Request("http://localhost:3000/api/expenses?from=2024-06-01&to=2024-06-30&limit=5");

    const response = await handleExpensesGet(req, {
      getSession: async () => ({ user: { email: "user@example.com" } }),
      queryFn: async ({ query }) => {
        const resolved = identityResolverQuery(query, { userId: "user-xyz" });
        if (resolved) return resolved;
        return [[
          { id: "1", purchase_date: "2024-06-20", created_at: "2024-06-20T09:00:00.000Z", amount_mxn: 1 },
          { id: "2", purchase_date: "2024-06-20", created_at: "2024-06-20T10:00:00.000Z", amount_mxn: 1 },
          { id: "3", purchase_date: "2024-06-19", created_at: "2024-06-19T12:00:00.000Z", amount_mxn: 1 }
        ]];
      }
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.items.map((item) => item.id), ["2", "1", "3"]);
  } finally {
    restore();
  }
});

test("GET /api/expenses con fallback usa chat_links y legacy chat_id", async () => {
  const restore = withEnv({ BQ_PROJECT_ID: "project", BQ_DATASET: "dataset", ENABLE_LEGACY_CHAT_FALLBACK: "true" });
  const queries = [];

  try {
    const { handleExpensesGet } = await import("../app/api/expenses/route.js");
    const req = new Request("http://localhost:3000/api/expenses?limit=10");

    const response = await handleExpensesGet(req, {
      getSession: async () => ({ user: { email: "user@example.com" } }),
      queryFn: async ({ query, params }) => {
        queries.push({ query, params });
        const resolved = identityResolverQuery(query, { userId: "user-xyz", chatId: "chat-legacy" });
        if (resolved) return resolved;
        if (query.includes("user_id = @user_id")) return [[]];
        if (query.includes("chat_id = @chat_id") && query.includes("user_id IS NULL")) {
          return [[{ id: "1", purchase_date: "2024-01-01", amount_mxn: 1, created_at: "2024-01-01T00:00:00Z" }]];
        }
        return [[]];
      }
    });

    assert.equal(response.status, 200);
    assert.ok(queries.some((entry) => entry.query.includes("FROM `project.dataset.chat_links`")));
    assert.ok(queries.some((entry) => entry.query.includes("chat_id = @chat_id") && entry.query.includes("user_id IS NULL")));
  } finally {
    restore();
  }
});


test("GET /api/expenses acepta fechas dd/mm/yyyy y las convierte a ISO", async () => {
  const restore = withEnv({ BQ_PROJECT_ID: "project", BQ_DATASET: "dataset" });
  let expensesParams = {};

  try {
    const { handleExpensesGet } = await import("../app/api/expenses/route.js");
    const req = new Request("http://localhost:3000/api/expenses?from=21/01/2026&to=20/02/2026&limit=2");

    const response = await handleExpensesGet(req, {
      getSession: async () => ({ user: { email: "user@example.com" } }),
      queryFn: async ({ query, params }) => {
        const resolved = identityResolverQuery(query, { userId: "user-xyz" });
        if (resolved) return resolved;
        expensesParams = params;
        return [[{ id: "1", purchase_date: "2026-02-20", created_at: "2026-02-20T10:00:00.000Z", amount_mxn: 1 }]];
      }
    });

    assert.equal(response.status, 200);
    assert.equal(expensesParams.from_date, "2026-01-21");
    assert.equal(expensesParams.to_date, "2026-02-20");
  } finally {
    restore();
  }
});

test("GET /api/expenses pagination usa next_cursor para traer la página siguiente sin repetir", async () => {
  const restore = withEnv({ BQ_PROJECT_ID: "project", BQ_DATASET: "dataset" });

  try {
    const { handleExpensesGet } = await import("../app/api/expenses/route.js");

    const firstResponse = await handleExpensesGet(new Request("http://localhost:3000/api/expenses?from=2026-01-01&to=2026-02-20&limit=2"), {
      getSession: async () => ({ user: { email: "user@example.com" } }),
      queryFn: async ({ query, params }) => {
        const resolved = identityResolverQuery(query, { userId: "user-xyz" });
        if (resolved) return resolved;
        if (!params.cursor_id) {
          return [[
            { id: "a", purchase_date: "2026-02-20", created_at: "2026-02-20T10:00:00.000Z", amount_mxn: 1 },
            { id: "b", purchase_date: "2026-02-19", created_at: "2026-02-19T10:00:00.000Z", amount_mxn: 1 },
            { id: "c", purchase_date: "2026-02-18", created_at: "2026-02-18T10:00:00.000Z", amount_mxn: 1 }
          ]];
        }
        return [[
          { id: "c", purchase_date: "2026-02-18", created_at: "2026-02-18T10:00:00.000Z", amount_mxn: 1 }
        ]];
      }
    });

    const firstBody = await firstResponse.json();
    assert.equal(firstResponse.status, 200);
    assert.deepEqual(firstBody.items.map((item) => item.id), ["a", "b"]);
    assert.ok(firstBody.next_cursor);

    const secondResponse = await handleExpensesGet(new Request(`http://localhost:3000/api/expenses?from=2026-01-01&to=2026-02-20&limit=2&cursor=${firstBody.next_cursor}`), {
      getSession: async () => ({ user: { email: "user@example.com" } }),
      queryFn: async ({ query, params }) => {
        const resolved = identityResolverQuery(query, { userId: "user-xyz" });
        if (resolved) return resolved;
        assert.equal(params.cursor_purchase_date, "2026-02-19");
        assert.equal(params.cursor_id, "b");
        return [[
          { id: "c", purchase_date: "2026-02-18", created_at: "2026-02-18T10:00:00.000Z", amount_mxn: 1 }
        ]];
      }
    });

    const secondBody = await secondResponse.json();
    assert.equal(secondResponse.status, 200);
    assert.deepEqual(secondBody.items.map((item) => item.id), ["c"]);
    assert.equal(secondBody.next_cursor, null);
  } finally {
    restore();
  }
});
