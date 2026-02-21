import assert from "node:assert/strict";
import test from "node:test";

const envKeys = ["BQ_PROJECT_ID", "BQ_DATASET", "E2E_AUTH_BYPASS", "NODE_ENV"];

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

test("endpoint-only flow: context + draft + insert + fetch (con bypass no-prod)", async () => {
  const restore = withEnv({ BQ_PROJECT_ID: "project", BQ_DATASET: "dataset", E2E_AUTH_BYPASS: "1", NODE_ENV: "test" });
  const inserted = [];

  try {
    const { handleExpenseCaptureContextGet } = await import("../app/api/expense-capture-context/route.js");
    const { handleExpenseDraftPost } = await import("../app/api/expense-draft/route.js");
    const { handleExpensesPost, handleExpensesGet } = await import("../app/api/expenses/route.js");

    const queryFn = async ({ query, params }) => {
      if (query.includes("FROM `project.dataset.users`")) return [[{ user_id: "user-flow" }]];
      if (query.includes("FROM `project.dataset.chat_links`")) return [[{ chat_id: "chat-flow" }]];
      if (query.includes("FROM `project.dataset.trips`")) return [[{ id: "trip-active", base_currency: "mxn" }]];

      if (query.includes("FROM `project.dataset.accounts`")) {
        if (params.owner_id === "user-flow") return [[{ account_name: "AMEX" }]];
        if (params.owner_id === "chat-flow") return [[{ account_name: "Nu" }]];
      }

      if (query.includes("FROM `project.dataset.card_rules`")) return [[]];

      if (query.includes("INSERT INTO `project.dataset.expenses`")) {
        inserted.push({ ...params, created_at: "2026-01-10T10:00:00.000Z" });
        return [[]];
      }

      if (query.includes("FROM `project.dataset.expenses`") && query.includes("user_id = @user_id")) {
        return [inserted.map((row) => ({ ...row, id: row.id, purchase_date: row.purchase_date, amount_mxn: row.amount_mxn, created_at: row.created_at }))];
      }
      if (query.includes("FROM `project.dataset.expenses`") && query.includes("chat_id = @chat_id")) return [[]];

      return [[]];
    };

    const fakeSession = { user: { email: "user@example.com" } };

    const capture = await handleExpenseCaptureContextGet(new Request("http://localhost:3000/api/expense-capture-context"), {
      getSession: async () => fakeSession,
      queryFn
    });
    const captureBody = await capture.json();
    assert.equal(capture.status, 200);
    assert.deepEqual(captureBody.methods.map((x) => x.label).sort(), ["AMEX", "Nu"]);

    const draft = await handleExpenseDraftPost(new Request("http://localhost:3000/api/expense-draft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "100 uber" })
    }), {
      getSession: async () => fakeSession,
      queryFn,
      now: new Date("2026-01-10T12:00:00.000Z")
    });
    const draftBody = await draft.json();
    assert.equal(draft.status, 200);
    assert.equal(draftBody.draft.original_amount, 100);
    assert.match(draftBody.draft.description.toLowerCase(), /uber/);

    const insert = await handleExpensesPost(new Request("http://localhost:3000/api/expenses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        purchase_date: draftBody.draft.purchase_date,
        amount: draftBody.draft.original_amount,
        payment_method: "AMEX",
        category: draftBody.draft.category,
        description: draftBody.draft.description,
        is_msi: false
      })
    }), {
      getSession: async () => fakeSession,
      queryFn,
      uuidFactory: () => "flow-1"
    });

    assert.equal(insert.status, 200);
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0].user_id, "user-flow");

    const expenses = await handleExpensesGet(new Request("http://localhost:3000/api/expenses?limit=10"), {
      getSession: async () => fakeSession,
      queryFn
    });
    const expensesBody = await expenses.json();
    assert.equal(expenses.status, 200);
    assert.equal(expensesBody.items[0].id, "flow-1");
  } finally {
    restore();
  }
});
