import assert from "node:assert/strict";
import test from "node:test";
import { evaluateSessionAccess } from "../lib/access_control.js";
import { getAllowedEmails } from "../lib/allowed_emails.js";

function withEnv(overrides) {
  const original = {};
  for (const [key, value] of Object.entries(overrides)) {
    original[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  return () => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

test("E2E_AUTH_BYPASS permite acceso aunque no haya sesión o allowlist", () => {
  const restore = withEnv({ E2E_AUTH_BYPASS: "1", NODE_ENV: "test", AUTH_ALLOWED_EMAILS: "" });
  try {
    const allowed = getAllowedEmails();
    assert.deepEqual(allowed, ["rafasf94@gmail.com"]);

    const access = evaluateSessionAccess(null, []);
    assert.equal(access.status, "ok");
    assert.equal(access.email, "rafasf94@gmail.com");
  } finally {
    restore();
  }
});

test("sin bypass se conserva validación normal", () => {
  const restore = withEnv({ E2E_AUTH_BYPASS: "0", NODE_ENV: "test", AUTH_ALLOWED_EMAILS: "" });
  try {
    const access = evaluateSessionAccess({ user: { email: "user@example.com" } }, []);
    assert.equal(access.status, "missing_allowlist");
  } finally {
    restore();
  }
});
