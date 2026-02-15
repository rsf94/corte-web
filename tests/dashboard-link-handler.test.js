import assert from "node:assert/strict";
import test from "node:test";

import { handleDashboardLinkToken } from "../lib/dashboard_link_handler.js";

test("handler /dashboard: sesión + link_token guarda chat_id en sesión y redirige sin token", async () => {
  const sessionState = {};
  const result = await handleDashboardLinkToken({
    linkToken: "token",
    hasSession: true,
    email: "user@correo.com",
    provider: "google",
    requestId: "r1",
    sessionState,
    consumeLinkToken: async () => ({ ok: true, chatId: "987" })
  });

  assert.equal(sessionState.chat_id, "987");
  assert.equal(result.redirectTo, "/dashboard");
  assert.equal(result.error, "");
});
