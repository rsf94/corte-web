import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const capturaChatFile = new URL("../app/dashboard/captura/captura-chat.js", import.meta.url);

test("A) UI no muestra quick replies de viaje cuando hasTrip=false", async () => {
  const source = await fs.readFile(capturaChatFile, "utf8");

  assert.match(source, /const shouldShowTripQuickReplies = Boolean\(flow\.draft && \(hasActiveTrip \|\| flow\.draft\?\.trip_id\)\)/);
  assert.match(source, /setHasActiveTrip\(backendHasTrip\)/);
  assert.match(source, /setIncludeTrip\(backendHasTrip\)/);
  assert.doesNotMatch(source, /<div className="mt-3 flex flex-wrap gap-2">\s*<button[\s\S]*Es del viaje/);
});

test("B) UI renderiza métodos cuando existen y evita copy de sin métodos legado", async () => {
  const source = await fs.readFile(capturaChatFile, "utf8");

  assert.match(source, /\{methodButtons\.map\(\(method\) => \(/);
  assert.match(source, /No hay métodos de pago disponibles\. Vincula al menos uno para confirmar\./);
  assert.doesNotMatch(source, /Sin métodos aún/);
});

test("C) happy path draft->método->confirm guarda y resetea input\/estado", async () => {
  const source = await fs.readFile(capturaChatFile, "utf8");

  assert.match(source, /setText\(""\)/);
  assert.match(source, /dispatch\(\{ type: "submit_text_start" \}\)/);
  assert.match(source, /dispatch\(\{ type: "select_payment_method", paymentMethod: method \}\)/);
  assert.match(source, /text: "Guardado ✅"/);
  assert.match(source, /dispatch\(\{ type: "reset_after_done" \}\)/);
});
