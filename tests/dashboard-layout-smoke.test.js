import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

test("dashboard layout incluye navegación principal", async () => {
  const layoutSource = await fs.readFile(new URL("../app/dashboard/layout.js", import.meta.url), "utf8");
  const navSource = await fs.readFile(new URL("../app/dashboard/dashboard-nav.js", import.meta.url), "utf8");

  assert.match(layoutSource, /Corte Dashboard/);
  assert.match(navSource, /Resumen/);
  assert.match(navSource, /Gastos/);
  assert.match(navSource, /Captura/);
});

test("páginas de dashboard muestran encabezados en español", async () => {
  const dashboardSource = await fs.readFile(new URL("../app/dashboard/page.js", import.meta.url), "utf8");
  const expensesPageSource = await fs.readFile(new URL("../app/dashboard/expenses/page.js", import.meta.url), "utf8");
  const capturePageSource = await fs.readFile(new URL("../app/dashboard/captura/page.js", import.meta.url), "utf8");

  assert.match(dashboardSource, /Pagos por tarjeta \(por mes\)/);
  assert.match(dashboardSource, /Vista mensual por tarjeta usando fechas de corte\./);
  assert.match(expensesPageSource, /Gastos/);
  assert.match(expensesPageSource, /Consulta tus gastos con filtros y paginación\./);
  assert.match(capturePageSource, /Registra tus gastos como en Telegram, pero desde web\./);
});
