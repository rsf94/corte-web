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

test("expenses explorer renders filtros tabla y paginación", async () => {
  const source = await fs.readFile(new URL("../app/dashboard/expenses/expenses-explorer.js", import.meta.url), "utf8");
  const filtersSource = await fs.readFile(new URL("../app/dashboard/expenses/expenses-filters.js", import.meta.url), "utf8");
  const tableSource = await fs.readFile(new URL("../app/dashboard/expenses/expenses-table.js", import.meta.url), "utf8");

  assert.match(source, /data-testid="expenses-explorer"/);
  assert.match(filtersSource, /Aplicar filtros/);
  assert.match(filtersSource, /comercio, descripción o texto original/);
  assert.doesNotMatch(source, /\+ Nuevo gasto/);
  assert.match(source, /Usa la pestaña Captura para registrar el primero/);
  assert.match(source, /Cargar más/);
  assert.match(source, /ExpensesTable/);
  assert.match(tableSource, /Fecha/);
  assert.match(tableSource, /Meses MSI/);
});



test("expenses explorer resets pagination when applying filters", async () => {
  const source = await fs.readFile(new URL("../app/dashboard/expenses/expenses-explorer.js", import.meta.url), "utf8");

  assert.match(source, /setNextCursor\(""\);/);
  assert.match(source, /runFetch\(\{ append: false, cursor: "", filters: \{ \.\.\.draft \} \}\);/);
});
test("captura chat smoke usa flujo draft y confirmación", async () => {
  const source = await fs.readFile(new URL("../app/dashboard/captura/captura-chat.js", import.meta.url), "utf8");

  assert.match(source, /data-testid="captura-chat"/);
  assert.match(source, /fetch\("\/api\/expense-capture-context"/);
  assert.match(source, /fetch\("\/api\/expense-draft"/);
  assert.match(source, /fetch\("\/api\/expenses"/);
  assert.match(source, /Confirmar/);
  assert.match(source, /✅ Guardado/);
});
