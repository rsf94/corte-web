import assert from "node:assert/strict";
import test from "node:test";

const envKeys = ["BQ_PROJECT_ID", "BQ_DATASET"];

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

test("expenses route returns 403 when session exists but has no LINKED chat", async () => {
  const restore = withEnv({ BQ_PROJECT_ID: "project", BQ_DATASET: "dataset" });

  try {
    const { handleExpensesGet } = await import("../app/api/expenses/route.js");
    const req = new Request("http://localhost:3000/api/expenses");

    const response = await handleExpensesGet(req, {
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

test("expenses route applies filters and seek pagination without OFFSET", async () => {
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
      `http://localhost:3000/api/expenses?from=2024-05-01&to=2024-06-30&payment_method=AMEX&category=Food&q=tacos&is_msi=false&limit=2&cursor=${cursor}`
    );

    const response = await handleExpensesGet(req, {
      getSession: async () => ({ user: { email: "user@example.com" } }),
      queryFn: async ({ query, params }) => {
        if (query.includes("user_links")) {
          return [[{ chat_id: "chat-linked" }]];
        }

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
          },
          {
            id: "2",
            purchase_date: "2024-06-08",
            created_at: "2024-06-08T10:00:00.000Z",
            payment_method: "AMEX",
            category: "Food",
            merchant: "Cafe",
            description: "Cafe",
            raw_text: "Cafe",
            amount_mxn: 90,
            is_msi: false,
            msi_months: null
          },
          {
            id: "1",
            purchase_date: "2024-06-07",
            created_at: "2024-06-07T10:00:00.000Z",
            payment_method: "AMEX",
            category: "Food",
            merchant: "Pan",
            description: "Pan",
            raw_text: "Pan",
            amount_mxn: 80,
            is_msi: false,
            msi_months: null
          }
        ]];
      }
    });

    assert.equal(response.status, 200);
    assert.doesNotMatch(expensesQuery, /OFFSET/i);
    assert.match(expensesQuery, /purchase_date < DATE\(@cursor_purchase_date\)/);
    assert.match(expensesQuery, /IFNULL\(is_msi, FALSE\) = @is_msi/);
    assert.equal(expensesParams.payment_method, "AMEX");
    assert.equal(expensesParams.category, "Food");
    assert.equal(expensesParams.q_like, "%tacos%");
    assert.equal(expensesParams.limit_plus_one, 3);

    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.items.length, 2);
    assert.ok(body.next_cursor);
  } finally {
    restore();
  }
});
