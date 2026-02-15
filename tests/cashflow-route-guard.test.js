import assert from "node:assert/strict";
import test from "node:test";

const envKeys = [
  "ALLOWED_EMAILS",
  "DASHBOARD_TOKEN"
];

test("cashflow route returns controlled 400 JSON when chat_id is missing", async () => {
  const original = {};
  for (const key of envKeys) {
    original[key] = process.env[key];
  }

  process.env.ALLOWED_EMAILS = "user@example.com";
  process.env.DASHBOARD_TOKEN = "token-ok";

  try {
    const { GET } = await import("../app/api/cashflow/route.js");
    const req = new Request("http://localhost:3000/api/cashflow?token=token-ok&from=2024-01-01&to=2024-02-01");

    const response = await GET(req);
    assert.equal(response.status, 400);

    const payload = await response.json();
    assert.deepEqual(payload, { error: "Missing chat_id" });
  } finally {
    for (const key of envKeys) {
      if (original[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original[key];
      }
    }
  }
});
