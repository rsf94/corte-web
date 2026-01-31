import assert from "node:assert/strict";
import test from "node:test";

const envKeys = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "NEXTAUTH_SECRET",
  "NEXTAUTH_URL"
];

test("auth route module imports without env vars", async () => {
  const original = {};
  for (const key of envKeys) {
    original[key] = process.env[key];
    delete process.env[key];
  }

  try {
    await assert.doesNotReject(() => import("../app/api/auth/[...nextauth]/route.js"));
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

test("auth route handles missing env vars with 500 response", async () => {
  const original = {};
  for (const key of envKeys) {
    original[key] = process.env[key];
    delete process.env[key];
  }

  try {
    const { GET } = await import("../app/api/auth/[...nextauth]/route.js");
    const response = await GET({ nextUrl: { pathname: "/api/auth/providers" } });
    assert.equal(response.status, 500);
    const payload = await response.json();
    assert.deepEqual(payload, { error: "Auth misconfigured" });
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
