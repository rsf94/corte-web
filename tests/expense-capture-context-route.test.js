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

test("GET /api/expense-capture-context mezcla métodos de user_id + chat_id", async () => {
  const restore = withEnv({ BQ_PROJECT_ID: "project", BQ_DATASET: "dataset" });

  try {
    const { handleExpenseCaptureContextGet } = await import("../app/api/expense-capture-context/route.js");
    const req = new Request("http://localhost:3000/api/expense-capture-context");

    const response = await handleExpenseCaptureContextGet(req, {
      getSession: async () => ({ user: { email: "user@example.com" } }),
      queryFn: async ({ query, params }) => {
        const resolved = identityResolverQuery(query, { userId: "user-123", chatId: "chat-999" });
        if (resolved) return resolved;

        if (query.includes("FROM `project.dataset.trips`")) return [[{ id: "trip-1", base_currency: "mxn" }]];
        if (query.includes("FROM `project.dataset.card_rules`")) {
          if (params.owner_id === "user-123") return [[{ card_name: "Amex Gold" }]];
          return [[{ card_name: "TDC Legacy" }]];
        }
        if (query.includes("FROM `project.dataset.expenses`")) {
          if (params.owner_id === "user-123") return [[{ payment_method: "BBVA Azul" }]];
          return [[{ payment_method: "Nu Débito" }]];
        }
        if (query.includes("FROM `project.dataset.accounts`")) {
          if (params.owner_id === "user-123") return [[{ account_name: "Amex Gold" }]];
          return [[{ account_name: "nu débito" }]];
        }

        return [[]];
      }
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.deepEqual(body.methods, [
      { id: "amex gold", label: "Amex Gold" },
      { id: "bbva azul", label: "BBVA Azul" },
      { id: "tdc legacy", label: "TDC Legacy" },
      { id: "nu débito", label: "Nu Débito" }
    ]);
    assert.equal(body.hasTrip, true);
    assert.equal(body.activeTripId, "trip-1");
  } finally {
    restore();
  }
});

test("GET /api/expense-capture-context no regresa vacío si legacy tiene métodos", async () => {
  const restore = withEnv({ BQ_PROJECT_ID: "project", BQ_DATASET: "dataset" });

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
          if (params.owner_id === "chat-999") return [[{ card_name: "Santander LikeU" }]];
          return [[]];
        }
        if (query.includes("FROM `project.dataset.expenses`")) return [[]];
        if (query.includes("FROM `project.dataset.accounts`")) return [[]];

        return [[]];
      }
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.methods, [{ id: "santander likeu", label: "Santander LikeU" }]);
    assert.equal(body.hasTrip, false);
    assert.equal(body.activeTripId, null);
  } finally {
    restore();
  }
});
