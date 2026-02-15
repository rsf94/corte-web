import assert from "node:assert/strict";
import test from "node:test";

import { buildFetchActiveLinksByEmailQuery } from "../lib/user_links.js";

test("active links query uses last_seen_at and never last_used_at", () => {
  const query = buildFetchActiveLinksByEmailQuery("`p.d.user_links`");

  assert.match(query, /last_seen_at/);
  assert.doesNotMatch(query, /last_used_at/);
});
