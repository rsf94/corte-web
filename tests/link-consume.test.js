import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { consumeLinkTokenAppendOnly } from "../lib/user_links.js";

process.env.BQ_PROJECT_ID = process.env.BQ_PROJECT_ID || "p";
process.env.BQ_DATASET = process.env.BQ_DATASET || "d";

function buildToken(randomPart, secret = "secret") {
  const signature = crypto.createHmac("sha256", secret).update(randomPart).digest("base64url");
  return `${randomPart}.${signature}`;
}

test("token inválido", async () => {
  const logs = [];
  const result = await consumeLinkTokenAppendOnly("bad.token", "a@b.com", "google", {
    secret: "secret",
    logger: (line) => logs.push(line),
    queryFn: async () => {
      throw new Error("should not query");
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "invalid_or_expired");
  assert.match(logs[0], /"result":"invalid_token"/);
});

test("token expirado/no existe falla al verificar", async () => {
  const token = buildToken("abc123");
  const queries = [];
  const result = await consumeLinkTokenAppendOnly(token, "a@b.com", "google", {
    secret: "secret",
    queryFn: async ({ query }) => {
      queries.push(query);
      return [[]];
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "expired_or_missing_or_consumed");
  assert.equal(queries.length, 3);
});

test("token válido inserta LINKED sin UPDATE", async () => {
  const token = buildToken("xyz789");
  const queries = [];
  const result = await consumeLinkTokenAppendOnly(token, "ok@b.com", "google", {
    secret: "secret",
    queryFn: async ({ query }) => {
      queries.push(query);
      if (query.includes("SELECT chat_id")) {
        return [[{ chat_id: "123" }]];
      }
      return [[]];
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.chatId, "123");
  assert.match(queries[1], /INSERT INTO/);
  assert.doesNotMatch(queries[1], /UPDATE\s+/);
});

test("token reusado (ya LINKED) falla", async () => {
  const token = buildToken("usedtoken");
  const queries = [];
  const result = await consumeLinkTokenAppendOnly(token, "ok@b.com", "google", {
    secret: "secret",
    queryFn: async ({ query }) => {
      queries.push(query);
      if (query.includes('status = "LINKED"')) {
        return [[{ reused: 1 }]];
      }
      return [[]];
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "already_used");
  assert.equal(queries.length, 1);
});
