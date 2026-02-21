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

function identityResolverQuery(query, { userId = "user-1", chatId = "" } = {}) {
  if (query.includes(".users")) return [[{ user_id: userId }]];
  if (query.includes(".chat_links")) return [[chatId ? { chat_id: chatId } : {}].filter((row) => row.chat_id)];
  return null;
}

test("GET /api/expense-capture-context normaliza métodos por user_id", async () => {
  const restore = withEnv({ BQ_PROJECT_ID: "project", BQ_DATASET: "dataset" });
  const queries = [];

  try {
    const { handleExpenseCaptureContextGet } = await import("../app/api/expense-capture-context/route.js");
    const req = new Request("http://localhost:3000/api/expense-capture-context");

    const response = await handleExpenseCaptureContextGet(req, {
      getSession: async () => ({ user: { email: "user@example.com" } }),
      queryFn: async ({ query, params }) => {
        queries.push({ query, params });
        const resolved = identityResolverQuery(query, { userId: "user-123" });
        if (resolved) return resolved;

        if (query.includes("FROM `project.dataset.trips`")) {
          return [[{ id: "trip-1", base_currency: "mxn" }]];
        }

        if (query.includes("FROM `project.dataset.card_rules`")) {
          return [[
            { payment_method: "Amex Gold" },
            { card_name: "BBVA Azul" },
            { account_name: "Amex Gold" }
          ]];
        }

        return [[]];
      }
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.deepEqual(body.suggestions.payment_methods, ["Amex Gold", "BBVA Azul"]);
    assert.deepEqual(body.active_trip, { id: "trip-1", base_currency: "MXN" });

    const cardRulesQuery = queries.find((entry) => entry.query.includes("FROM `project.dataset.card_rules`"));
    assert.ok(cardRulesQuery);
    assert.equal(cardRulesQuery.params.owner_id, "user-123");
  } finally {
    restore();
  }
});

test("GET /api/expense-capture-context usa fallback de chat_id si user_id no tiene métodos", async () => {
  const restore = withEnv({ BQ_PROJECT_ID: "project", BQ_DATASET: "dataset" });
  const ownerIds = [];

  try {
    const { handleExpenseCaptureContextGet } = await import("../app/api/expense-capture-context/route.js");
    const req = new Request("http://localhost:3000/api/expense-capture-context");

    const response = await handleExpenseCaptureContextGet(req, {
      getSession: async () => ({ user: { email: "user@example.com" } }),
      queryFn: async ({ query, params }) => {
        const resolved = identityResolverQuery(query, { userId: "user-123", chatId: "chat-999" });
        if (resolved) return resolved;

        if (query.includes("FROM `project.dataset.trips`")) return [[]];

        if (query.includes("FROM `project.dataset.card_rules`")) {
          ownerIds.push(params.owner_id);
          if (params.owner_id === "user-123") return [[]];
          return [[{ card_name: "TDC Legacy" }]];
        }

        if (query.includes("FROM `project.dataset.expenses`")) {
          return [[]];
        }

        return [[]];
      }
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.suggestions.payment_methods, ["TDC Legacy"]);
    assert.deepEqual(ownerIds, ["user-123", "chat-999"]);
  } finally {
    restore();
  }
});
