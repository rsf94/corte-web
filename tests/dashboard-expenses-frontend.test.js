import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import { buildExpensesQueryParams, getDefaultExpensesDateRange } from "../lib/dashboard_expenses.js";

test("expenses default date range uses last 30 days", () => {
  const base = new Date("2026-05-18T10:00:00.000Z");
  const range = getDefaultExpensesDateRange(base);

  assert.equal(range.to, "2026-05-18");
  assert.equal(range.from, "2026-04-18");
});

test("expenses query params include filters and omit is_msi when set to all", () => {
  const params = buildExpensesQueryParams(
    {
      from: "2026-04-18",
      to: "2026-05-18",
      payment_method: "AMEX",
      category: "Food",
      q: "cafe",
      is_msi: "all"
    },
    { limit: 50 }
  );

  assert.equal(params.get("from"), "2026-04-18");
  assert.equal(params.get("payment_method"), "AMEX");
  assert.equal(params.get("category"), "Food");
  assert.equal(params.get("q"), "cafe");
  assert.equal(params.get("is_msi"), null);
  assert.equal(params.get("limit"), "50");
});

test("expenses explorer renders filters table and pagination controls", async () => {
  const source = await fs.readFile(new URL("../app/dashboard/expenses/expenses-explorer.js", import.meta.url), "utf8");
  const filtersSource = await fs.readFile(new URL("../app/dashboard/expenses/expenses-filters.js", import.meta.url), "utf8");

  assert.match(source, /data-testid="expenses-explorer"/);
  assert.match(filtersSource, /Apply Filters/);
  assert.match(source, /Load More/);
  assert.match(source, /ExpensesTable/);
});
