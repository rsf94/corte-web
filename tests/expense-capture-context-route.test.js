import assert from "node:assert/strict";
import test from "node:test";

const envKeys = ["BQ_PROJECT_ID", "BQ_DATASET", "NODE_ENV"];

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

function identityResolverQuery(query, { userId = "user-1", chatId = "" } = {}) {
  if (query.includes(".users")) return [[{ user_id: userId }]];
  if (query.includes(".chat_links")) return [chatId ? [{ chat_id: chatId }] : []];
  return null;
}

test("GET /api/expense-capture-context mezcla methods de accounts user_id + chat_id y dedupe", async () => {
  const restore = withEnv({ BQ_PROJECT_ID: "project", BQ_DATASET: "dataset", NODE_ENV: "test" });

  try {
    const { handleExpenseCaptureContextGet } = await import("../app/api/expense-capture-context/route.js");
    const req = new Request("http://localhost:3000/api/expense-capture-context");

    const response = await handleExpenseCaptureContextGet(req, {
      getSession: async () => ({ user: { email: "user@example.com" } }),
      queryFn: async ({ query, params }) => {
        const resolved = identityResolverQuery(query, { userId: "user-123", chatId: "chat-999" });
        if (resolved) return resolved;

        if (query.includes("FROM `project.dataset.trips`")) return [[{ id: "trip-1", base_currency: "mxn" }]];
        if (query.includes("FROM `project.dataset.accounts`")) {
          if (params.owner_id === "user-123") return [[{ account_name: "Amex Gold" }]];
          if (params.owner_id === "chat-999") return [[{ account_name: "Nu Débito" }, { account_name: "amex gold" }]];
        }
        if (query.includes("FROM `project.dataset.card_rules`")) {
          if (params.owner_id === "user-123") return [[{ card_name: "BBVA Azul" }]];
          if (params.owner_id === "chat-999") return [[{ card_name: "TDC Legacy" }]];
        }

        return [[]];
      }
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.deepEqual(body.methods, [
      { id: "amex gold", label: "Amex Gold" },
      { id: "nu débito", label: "Nu Débito" },
      { id: "bbva azul", label: "BBVA Azul" },
      { id: "tdc legacy", label: "TDC Legacy" }
    ]);
    assert.deepEqual(body.defaults.source_counts, { user: 2, chat: 3, merged: 4 });
    assert.equal(body.diagnostics.resolved_chat_id, "chat-999");
    assert.equal(body.hasTrip, true);
    assert.equal(body.activeTripId, "trip-1");
  } finally {
    restore();
  }
});

test("GET /api/expense-capture-context sigue regresando methods si falla una fuente de BQ", async () => {
  const restore = withEnv({ BQ_PROJECT_ID: "project", BQ_DATASET: "dataset", NODE_ENV: "test" });

  try {
    const { handleExpenseCaptureContextGet } = await import("../app/api/expense-capture-context/route.js");
    const req = new Request("http://localhost:3000/api/expense-capture-context");

    const response = await handleExpenseCaptureContextGet(req, {
      getSession: async () => ({ user: { email: "user@example.com" } }),
      queryFn: async ({ query, params }) => {
        const resolved = identityResolverQuery(query, { userId: "user-123", chatId: "chat-999" });
        if (resolved) return resolved;

        if (query.includes("FROM `project.dataset.trips`")) return [[]];
        if (query.includes("FROM `project.dataset.accounts`")) {
          if (params.owner_id === "user-123") throw new Error("accounts user query failed");
          if (params.owner_id === "chat-999") return [[{ account_name: "Santander LikeU" }]];
        }
        if (query.includes("FROM `project.dataset.card_rules`")) return [[]];

        return [[]];
      }
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.methods, [{ id: "santander likeu", label: "Santander LikeU" }]);
    assert.equal(body.diagnostics.query_status.accounts_user.status, "error");
    assert.match(body.diagnostics.query_status.accounts_user.error, /accounts user query failed/);
    assert.equal(body.diagnostics.final_methods_count, 1);
  } finally {
    restore();
  }
});
