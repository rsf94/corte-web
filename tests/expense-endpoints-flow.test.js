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

test("black-box endpoints flow: capture-context -> draft -> insert -> expenses", async () => {
  const restore = withEnv({ BQ_PROJECT_ID: "project", BQ_DATASET: "dataset" });
  const inserted = [];

  try {
    const { handleExpenseCaptureContextGet } = await import("../app/api/expense-capture-context/route.js");
    const { handleExpenseDraftPost } = await import("../app/api/expense-draft/route.js");
    const { handleExpensesPost, handleExpensesGet } = await import("../app/api/expenses/route.js");

    const queryFn = async ({ query, params }) => {
      if (query.includes("FROM `project.dataset.users`")) return [[{ user_id: "user-flow" }]];
      if (query.includes("FROM `project.dataset.chat_links`")) return [[{ chat_id: "chat-flow" }]];
      if (query.includes("FROM `project.dataset.trips`")) return [[{ id: "trip-active", base_currency: "mxn" }]];

      if (query.includes("FROM `project.dataset.card_rules`")) {
        if (params.owner_id === "user-flow") return [[{ card_name: "AMEX" }]];
        if (params.owner_id === "chat-flow") return [[{ card_name: "Nu" }]];
      }

      if (query.includes("INSERT INTO `project.dataset.expenses`")) {
        inserted.push({ ...params, created_at: "2026-01-10T10:00:00.000Z" });
        return [[]];
      }

      if (query.includes("FROM `project.dataset.expenses`") && query.includes("user_id = @user_id")) {
        return [inserted.map((row) => ({
          id: row.id,
          purchase_date: row.purchase_date,
          payment_method: row.payment_method,
          category: row.category,
          merchant: row.merchant,
          description: row.description,
          amount_mxn: row.amount_mxn,
          is_msi: row.is_msi,
          msi_months: row.msi_months,
          created_at: row.created_at
        }))];
      }

      if (query.includes("FROM `project.dataset.expenses`") && query.includes("chat_id = @chat_id")) {
        return [[{ id: "legacy-1", purchase_date: "2026-01-09", created_at: "2026-01-09T09:00:00.000Z", amount_mxn: 50 }]];
      }

      return [[]];
    };

    const capture = await handleExpenseCaptureContextGet(new Request("http://localhost:3000/api/expense-capture-context"), {
      getSession: async () => ({ user: { email: "user@example.com" } }),
      queryFn
    });
    const captureBody = await capture.json();
    assert.equal(capture.status, 200);
    assert.equal(captureBody.methods.length, 2);
    assert.equal(captureBody.hasTrip, true);
    assert.equal(captureBody.activeTripId, "trip-active");

    const draft = await handleExpenseDraftPost(new Request("http://localhost:3000/api/expense-draft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "1400 laptop a 12 MSI" })
    }), {
      getSession: async () => ({ user: { email: "user@example.com" } }),
      queryFn,
      now: new Date("2026-01-10T12:00:00.000Z")
    });
    const draftBody = await draft.json();
    assert.equal(draft.status, 200);
    assert.equal(draftBody.draft.is_msi, true);
    assert.equal(draftBody.draft.msi_months, 12);
    assert.equal(draftBody.draft.trip_id, "trip-active");

    const insert = await handleExpensesPost(new Request("http://localhost:3000/api/expenses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        purchase_date: draftBody.draft.purchase_date,
        amount: draftBody.draft.original_amount,
        payment_method: "AMEX",
        category: draftBody.draft.category,
        description: draftBody.draft.description,
        is_msi: draftBody.draft.is_msi,
        msi_months: draftBody.draft.msi_months,
        trip_id: draftBody.draft.trip_id
      })
    }), {
      getSession: async () => ({ user: { email: "user@example.com" } }),
      queryFn,
      uuidFactory: () => "flow-1"
    });
    const insertBody = await insert.json();
    assert.equal(insert.status, 200);
    assert.equal(insertBody.id, "flow-1");

    const expenses = await handleExpensesGet(new Request("http://localhost:3000/api/expenses?limit=10"), {
      getSession: async () => ({ user: { email: "user@example.com" } }),
      queryFn
    });
    const expensesBody = await expenses.json();
    assert.equal(expenses.status, 200);
    assert.equal(expensesBody.items[0].id, "flow-1");
    assert.equal(expensesBody.items[0].msi_months, 12);
    assert.equal(expensesBody.items[0].source, "web_user");
    assert.equal(expensesBody.items[1].id, "legacy-1");
  } finally {
    restore();
  }
});
