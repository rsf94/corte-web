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

function identityResolverQuery(query, { userId = "user-1" } = {}) {
  if (query.includes(".users")) return [[{ user_id: userId }]];
  return null;
}

test("GET /api/expense-capture-context normaliza métodos de pago y conserva suggestions.payment_methods", async () => {
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

        if (query.includes("FROM `project.dataset.expenses`")) {
          return [[{ payment_method: "No debería usarse" }]];
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
    assert.equal(cardRulesQuery.params.user_id, "user-123");
    assert.doesNotMatch(cardRulesQuery.query, /chat_id/);

    assert.equal(queries.some((entry) => entry.query.includes("FROM `project.dataset.expenses`")), false);
  } finally {
    restore();
  }
});
