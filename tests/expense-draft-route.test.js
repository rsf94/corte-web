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

test("POST /api/expense-draft texto simple en MXN", async () => {
  const restore = withEnv({ BQ_PROJECT_ID: "project", BQ_DATASET: "dataset" });

  try {
    const { handleExpenseDraftPost } = await import("../app/api/expense-draft/route.js");
    const req = new Request("http://localhost:3000/api/expense-draft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "230 uber" })
    });

    const response = await handleExpenseDraftPost(req, {
      getSession: async () => ({ user: { email: "user@example.com" } }),
      queryFn: async ({ query }) => identityResolverQuery(query, { userId: "user-123" }),
      now: new Date("2026-01-10T12:00:00.000Z")
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.draft.original_amount, 230);
    assert.equal(body.draft.original_currency, "MXN");
    assert.equal(body.draft.amount_mxn_source, "direct");
    assert.equal(body.draft.purchase_date, "2026-01-10");
  } finally {
    restore();
  }
});

test("POST /api/expense-draft texto con MSI", async () => {
  const restore = withEnv({ BQ_PROJECT_ID: "project", BQ_DATASET: "dataset" });

  try {
    const { handleExpenseDraftPost } = await import("../app/api/expense-draft/route.js");
    const req = new Request("http://localhost:3000/api/expense-draft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "140 autolavado a 3 MSI" })
    });

    const response = await handleExpenseDraftPost(req, {
      getSession: async () => ({ user: { email: "user@example.com" } }),
      queryFn: async ({ query }) => identityResolverQuery(query, { userId: "user-123" }),
      now: new Date("2026-01-10T12:00:00.000Z")
    });

    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.draft.is_msi, true);
    assert.equal(body.draft.msi_months, 3);
  } finally {
    restore();
  }
});

test("POST /api/expense-draft texto con moneda usa fx", async () => {
  const restore = withEnv({ BQ_PROJECT_ID: "project", BQ_DATASET: "dataset" });

  try {
    const { handleExpenseDraftPost } = await import("../app/api/expense-draft/route.js");
    const req = new Request("http://localhost:3000/api/expense-draft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "1200 JPY ramen" })
    });

    const response = await handleExpenseDraftPost(req, {
      getSession: async () => ({ user: { email: "user@example.com" } }),
      queryFn: async ({ query }) => identityResolverQuery(query, { userId: "user-123" }),
      fxConverter: async () => ({ rate: 0.12, provider: "frankfurter", date: "2026-01-10" }),
      now: new Date("2026-01-10T12:00:00.000Z")
    });

    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.draft.original_currency, "JPY");
    assert.equal(body.draft.fx_provider, "frankfurter");
    assert.equal(body.draft.fx_rate, 0.12);
    assert.equal(body.draft.amount_mxn_source, "fx");
    assert.equal(body.draft.amount_mxn, 144);
  } finally {
    restore();
  }
});


test("POST /api/expense-draft usa parser del core cuando está disponible", async () => {
  const restore = withEnv({ BQ_PROJECT_ID: "project", BQ_DATASET: "dataset" });
  let parserCalls = 0;

  try {
    const { handleExpenseDraftPost } = await import("../app/api/expense-draft/route.js");
    const req = new Request("http://localhost:3000/api/expense-draft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Starbucks 120" })
    });

    const response = await handleExpenseDraftPost(req, {
      getSession: async () => ({ user: { email: "user@example.com" } }),
      queryFn: async ({ query }) => identityResolverQuery(query, { userId: "user-123" }),
      parseDraft: async (text, { now }) => {
        parserCalls += 1;
        assert.equal(text, "Starbucks 120");
        assert.ok(now instanceof Date);
        return {
          error: "",
          parsed: {
            raw_text: "Starbucks 120",
            purchase_date: "2026-01-10",
            original_amount: 120,
            detected_currency: "",
            description: "Starbucks",
            merchant: "Starbucks",
            category: "General",
            is_msi: false,
            msi_months: null
          }
        };
      },
      now: new Date("2026-01-10T12:00:00.000Z")
    });

    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(parserCalls, 1);
    assert.equal(body.draft.original_amount, 120);
    assert.equal(body.draft.description, "Starbucks");
  } finally {
    restore();
  }
});


test("POST /api/expense-draft MSI explícito sin meses conserva is_msi=true y msi_months=null", async () => {
  const restore = withEnv({ BQ_PROJECT_ID: "project", BQ_DATASET: "dataset" });

  try {
    const { handleExpenseDraftPost } = await import("../app/api/expense-draft/route.js");
    const req = new Request("http://localhost:3000/api/expense-draft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "250 MSI supermercado" })
    });

    const response = await handleExpenseDraftPost(req, {
      getSession: async () => ({ user: { email: "user@example.com" } }),
      queryFn: async ({ query }) => {
        const resolved = identityResolverQuery(query, { userId: "user-123" });
        if (resolved) return resolved;
        if (query.includes("FROM `project.dataset.trips`")) return [[]];
        return [[]];
      },
      now: new Date("2026-01-10T12:00:00.000Z")
    });

    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.draft.is_msi, true);
    assert.equal(body.draft.msi_months, null);
  } finally {
    restore();
  }
});

test("POST /api/expense-draft no aplica trip_id cuando no hay viaje activo", async () => {
  const restore = withEnv({ BQ_PROJECT_ID: "project", BQ_DATASET: "dataset" });

  try {
    const { handleExpenseDraftPost } = await import("../app/api/expense-draft/route.js");
    const req = new Request("http://localhost:3000/api/expense-draft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "230 uber", trip_id: "trip-stale" })
    });

    const response = await handleExpenseDraftPost(req, {
      getSession: async () => ({ user: { email: "user@example.com" } }),
      queryFn: async ({ query }) => {
        const resolved = identityResolverQuery(query, { userId: "user-123" });
        if (resolved) return resolved;
        if (query.includes("FROM `project.dataset.trips`")) return [[]];
        return [[]];
      },
      now: new Date("2026-01-10T12:00:00.000Z")
    });

    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.draft.trip_id, null);
  } finally {
    restore();
  }
});
