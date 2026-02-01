import assert from "node:assert/strict";
import test from "node:test";
import { evaluateSessionAccess, getDashboardRedirect } from "../lib/access_control.js";

test("getDashboardRedirect sends missing session to login", () => {
  const redirectTo = getDashboardRedirect({
    sessionStatus: "missing_session",
    usingTokenFallback: false
  });
  assert.equal(redirectTo, "/login");
});

test("evaluateSessionAccess denies when session email is not allowed", () => {
  const session = { user: { email: "persona@correo.com" } };
  const access = evaluateSessionAccess(session, ["otro@correo.com"]);
  assert.equal(access.status, "email_not_allowed");
});
