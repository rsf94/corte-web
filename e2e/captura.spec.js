import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/expense-capture-context", async (route) => {
    const body = {
      ok: true,
      hasTrip: false,
      activeTripId: null,
      active_trip: null,
      methods: [
        { id: "m1", label: "Amex Gold" },
        { id: "m2", label: "Nu Débito" }
      ],
      defaults: {}
    };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
});

test("A) hasTrip=false oculta quick replies de viaje", async ({ page }) => {
  await page.route("**/api/expense-draft", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        draft: {
          purchase_date: "2026-01-01",
          original_amount: 230,
          original_currency: "MXN",
          amount_mxn: 230,
          payment_method: "",
          category: "General",
          description: "uber",
          is_msi: false,
          msi_months: null,
          trip_id: null
        }
      })
    });
  });

  await page.goto("/dashboard/captura");
  await page.getByPlaceholder("Ej: 230 uber").fill("230 uber");
  await page.getByRole("button", { name: "Enviar" }).click();

  await expect(page.getByRole("button", { name: "Es del viaje" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "No es del viaje" })).toHaveCount(0);
});

test("B y C) muestra métodos y resetea a idle tras confirmar", async ({ page }) => {
  await page.route("**/api/expense-draft", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        draft: {
          purchase_date: "2026-01-01",
          original_amount: 400,
          original_currency: "MXN",
          amount_mxn: 400,
          payment_method: "",
          category: "General",
          description: "super",
          is_msi: false,
          msi_months: null,
          trip_id: null
        }
      })
    });
  });

  await page.route("**/api/expenses", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });

  await page.goto("/dashboard/captura");
  await page.getByPlaceholder("Ej: 230 uber").fill("400 super");
  await page.getByRole("button", { name: "Enviar" }).click();

  await expect(page.getByText("Sin métodos")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Amex Gold" })).toBeVisible();
  await page.getByRole("button", { name: "Amex Gold" }).click();
  await page.getByRole("button", { name: "Confirmar" }).click();

  await expect(page.getByText("Guardado ✅")).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirmar" })).toHaveCount(0);
});
