import assert from "node:assert/strict";
import test from "node:test";

import {
  ensureUserExistsByEmail,
  insertChatLink,
  resolveChatIdForUser,
  resolveLatestLinkedChatIdByEmail
} from "../lib/identity_links.js";

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

test("email normalization lowercases and trims while ensuring user", async () => {
  const restore = withEnv({ BQ_PROJECT_ID: "project", BQ_DATASET: "dataset" });
  const seenEmails = [];

  try {
    const result = await ensureUserExistsByEmail("  USER@Example.COM  ", {
      userIdFactory: () => "user-123",
      queryFn: async ({ query, params }) => {
        if (params?.email) seenEmails.push(params.email);
        if (query.includes("SELECT user_id")) return [[]];
        return [[]];
      }
    });

    assert.equal(result.email, "user@example.com");
    assert.equal(result.userId, "user-123");
    assert.deepEqual(seenEmails, ["user@example.com", "user@example.com"]);
  } finally {
    restore();
  }
});

test("ensure user exists inserts row when missing", async () => {
  const restore = withEnv({ BQ_PROJECT_ID: "project", BQ_DATASET: "dataset" });
  const queries = [];

  try {
    const result = await ensureUserExistsByEmail("new@example.com", {
      userIdFactory: () => "new-user-id",
      queryFn: async ({ query }) => {
        queries.push(query);
        return [[]];
      }
    });

    assert.equal(result.userId, "new-user-id");
    assert.equal(queries.length, 2);
    assert.match(queries[0], /SELECT user_id/);
    assert.match(queries[1], /INSERT INTO `project\.dataset\.users`/);
  } finally {
    restore();
  }
});

test("identity inserts avoid null BigQuery params for metadata", async () => {
  const restore = withEnv({ BQ_PROJECT_ID: "project", BQ_DATASET: "dataset" });
  const queryOptions = [];

  try {
    await ensureUserExistsByEmail("new@example.com", {
      userIdFactory: () => "new-user-id",
      queryFn: async (options) => {
        queryOptions.push(options);
        if (options.query.includes("SELECT user_id")) return [[]];
        return [[]];
      }
    });

    await insertChatLink(
      {
        chatId: "chat-11",
        userId: "new-user-id",
        metadata: null
      },
      {
        queryFn: async (options) => {
          queryOptions.push(options);
          return [[]];
        }
      }
    );

    const userInsert = queryOptions.find((options) =>
      options.query.includes("INSERT INTO `project.dataset.users`")
    );
    assert.ok(userInsert, "expected users insert query");
    assert.match(userInsert.query, /CAST\(NULL AS JSON\)/);
    assert.equal("metadata" in userInsert.params, false);

    const chatInsert = queryOptions.find((options) =>
      options.query.includes("INSERT INTO `project.dataset.chat_links`")
    );
    assert.ok(chatInsert, "expected chat_links insert query");
    assert.match(chatInsert.query, /CAST\(NULL AS JSON\)/);
    assert.equal("metadata" in chatInsert.params, false);

    const nullParamQuery = queryOptions.find((options) =>
      Object.values(options.params || {}).some((value) => value === null)
    );
    assert.equal(nullParamQuery, undefined);
  } finally {
    restore();
  }
});

test("resolve chat authorization follows users -> chat_links", async () => {
  const restore = withEnv({ BQ_PROJECT_ID: "project", BQ_DATASET: "dataset" });
  const calls = [];

  try {
    const chatId = await resolveLatestLinkedChatIdByEmail("user@example.com", {
      queryFn: async ({ query }) => {
        calls.push(query);
        if (query.includes("FROM `project.dataset.users`")) return [[{ user_id: "u-1" }]];
        if (query.includes("FROM `project.dataset.chat_links`")) return [[{ chat_id: "chat-77" }]];
        return [[]];
      }
    });

    assert.equal(chatId, "chat-77");
    assert.equal(calls.length, 2);
    assert.match(calls[0], /users/);
    assert.match(calls[1], /chat_links/);
  } finally {
    restore();
  }
});

test("resolveChatIdForUser obtiene chat_id activo para user_id", async () => {
  const restore = withEnv({ BQ_PROJECT_ID: "project", BQ_DATASET: "dataset" });

  try {
    const chatId = await resolveChatIdForUser("u-1", {
      queryFn: async ({ query, params }) => {
        assert.match(query, /FROM `project\.dataset\.chat_links`/);
        assert.deepEqual(params, { user_id: "u-1" });
        return [[{ chat_id: "chat-abc" }]];
      }
    });

    assert.equal(chatId, "chat-abc");
  } finally {
    restore();
  }
});
