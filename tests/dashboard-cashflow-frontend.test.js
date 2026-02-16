import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import { buildStackedChartData, getDefaultRange } from "../lib/dashboard_cashflow.js";

test("default range uses month -2 to month +2", () => {
  const base = new Date(2026, 4, 18);
  const range = getDefaultRange(base);

  assert.equal(range.from, "2026-03-01");
  assert.equal(range.to, "2026-07-01");
});

test("dashboard table component no longer includes MSI toggle", async () => {
  const source = await fs.readFile(new URL("../app/dashboard/cashflow-table.js", import.meta.url), "utf8");

  assert.doesNotMatch(source, /exclude_msi/i);
  assert.doesNotMatch(source, /Excluir MSI/);
});

test("dashboard table component renders stacked bar chart section", async () => {
  const source = await fs.readFile(new URL("../app/dashboard/cashflow-table.js", import.meta.url), "utf8");

  assert.match(source, /data-testid="cashflow-chart"/);
  assert.match(source, /columnHeight/);
  assert.match(source, /function CustomBarTooltip/);

  const chartData = buildStackedChartData(
    {
      months: ["2026-03", "2026-04"],
      rows: [
        { card_name: "American Express", totals: { "2026-03": 100, "2026-04": 200 } },
        { card_name: "Santander", totals: { "2026-03": 50, "2026-04": 75 } }
      ],
      totals: { "2026-03": 150, "2026-04": 275 }
    },
    []
  );

  assert.deepEqual(chartData, [
    {
      month: "2026-03",
      total: 150,
      "American Express": 100,
      Santander: 50
    },
    {
      month: "2026-04",
      total: 275,
      "American Express": 200,
      Santander: 75
    }
  ]);
});

test("dashboard table aligns chart layout with month columns and shades past months", async () => {
  const source = await fs.readFile(new URL("../app/dashboard/cashflow-table.js", import.meta.url), "utf8");

  assert.match(source, /CARD_COLUMN_WIDTH = 220/);
  assert.match(source, /gridTemplateColumns: `\$\{CARD_COLUMN_WIDTH\}px minmax\(0, 1fr\)`/);
  assert.match(source, /pastMonths\.has\(month\) \? "bg-slate-50" : ""/);
  assert.match(source, /monthLabelToStartISO/);
});
