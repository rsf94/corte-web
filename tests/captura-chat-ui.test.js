import assert from "node:assert/strict";
import test from "node:test";

import { CAPTURA_PHASES, captureFlowReducer, createInitialCaptureState } from "../lib/captura_flow.js";
import {
  createMethodHint,
  createWelcomeMessage,
  resolveDraftMethod,
  shouldShowTripQuickReplies
} from "../lib/captura_chat_logic.js";

const methods = [
  { id: "amex", label: "Amex Gold" },
  { id: "bbva", label: "BBVA Azul" }
];

const draft = {
  purchase_date: "2026-03-10",
  original_amount: 100,
  original_currency: "MXN",
  amount_mxn: 100,
  description: "uber",
  is_msi: false,
  msi_months: null,
  payment_method: "amex gold"
};

test("smoke frontend: render inicial muestra saludo", () => {
  const firstMessage = createWelcomeMessage();
  assert.match(firstMessage.text, /Hola/);
  assert.equal(firstMessage.role, "system");
});

test("smoke frontend: hasTrip=false no muestra controles de viaje", () => {
  assert.equal(shouldShowTripQuickReplies({ draft, hasActiveTrip: false }), false);
  assert.equal(shouldShowTripQuickReplies({ draft, hasActiveTrip: true }), true);
});

test("smoke frontend: submit texto crea draft, seleccionar método habilita confirmar y confirmar resetea", () => {
  let state = createInitialCaptureState();

  state = captureFlowReducer(state, { type: "submit_text_start" });
  state = captureFlowReducer(state, { type: "submit_text_success", draft });
  assert.equal(state.phase, CAPTURA_PHASES.AWAITING_PAYMENT_METHOD);

  const match = resolveDraftMethod(draft, methods);
  assert.equal(match.selectedMethod, "Amex Gold");
  assert.match(createMethodHint(match), /Método detectado/);

  state = captureFlowReducer(state, { type: "select_payment_method", paymentMethod: match.selectedMethod });
  assert.equal(state.phase, CAPTURA_PHASES.READY_TO_CONFIRM);

  state = captureFlowReducer(state, { type: "confirm_start" });
  state = captureFlowReducer(state, { type: "confirm_success" });
  state = captureFlowReducer(state, { type: "reset_after_done" });

  assert.deepEqual(state, createInitialCaptureState());
});
