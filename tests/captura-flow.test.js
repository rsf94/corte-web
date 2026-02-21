import assert from "node:assert/strict";
import test from "node:test";

import { CAPTURA_PHASES, captureFlowReducer, createInitialCaptureState, draftNeedsMsiMonths } from "../lib/captura_flow.js";

const baseDraft = {
  purchase_date: "2026-03-10",
  original_amount: 140,
  original_currency: "MXN",
  amount_mxn: 140,
  description: "autolavado",
  is_msi: false,
  msi_months: null
};

test("captura usa métodos reales del endpoint y permite seleccionar método", () => {
  let state = createInitialCaptureState();
  state = captureFlowReducer(state, { type: "submit_text_start" });
  state = captureFlowReducer(state, { type: "submit_text_success", draft: baseDraft });

  assert.equal(state.phase, CAPTURA_PHASES.AWAITING_PAYMENT_METHOD);

  state = captureFlowReducer(state, { type: "select_payment_method", paymentMethod: "Amex Gold" });
  assert.equal(state.selectedPaymentMethod, "Amex Gold");
  assert.equal(state.phase, CAPTURA_PHASES.READY_TO_CONFIRM);
});

test("draft -> seleccionar método -> confirmar resetea estado", () => {
  let state = createInitialCaptureState();
  state = captureFlowReducer(state, { type: "submit_text_success", draft: baseDraft });
  state = captureFlowReducer(state, { type: "select_payment_method", paymentMethod: "BBVA Azul" });
  state = captureFlowReducer(state, { type: "confirm_start" });

  assert.equal(state.phase, CAPTURA_PHASES.SAVING);

  state = captureFlowReducer(state, { type: "confirm_success" });
  assert.equal(state.phase, CAPTURA_PHASES.DONE);

  state = captureFlowReducer(state, { type: "reset_after_done" });
  assert.deepEqual(state, createInitialCaptureState());
});

test("cancel limpia todo el flujo", () => {
  let state = createInitialCaptureState();
  state = captureFlowReducer(state, { type: "submit_text_success", draft: baseDraft });
  state = captureFlowReducer(state, { type: "select_payment_method", paymentMethod: "Debito" });

  state = captureFlowReducer(state, { type: "cancel" });
  assert.deepEqual(state, createInitialCaptureState());
});

test("MSI con meses explícitos no pide meses, MSI sin meses sí pide", () => {
  const explicitMsiDraft = { ...baseDraft, is_msi: true, msi_months: 3 };
  const missingMsiMonthsDraft = { ...baseDraft, is_msi: true, msi_months: null };

  assert.equal(draftNeedsMsiMonths(explicitMsiDraft), false);
  assert.equal(draftNeedsMsiMonths(missingMsiMonthsDraft), true);

  let state = createInitialCaptureState();
  state = captureFlowReducer(state, { type: "submit_text_success", draft: missingMsiMonthsDraft });
  state = captureFlowReducer(state, { type: "select_payment_method", paymentMethod: "Amex" });

  assert.equal(state.phase, CAPTURA_PHASES.AWAITING_MSI_MONTHS);

  state = captureFlowReducer(state, { type: "set_msi_months", months: "6" });
  assert.equal(state.phase, CAPTURA_PHASES.READY_TO_CONFIRM);
  assert.equal(state.draft.msi_months, 6);
});


test("nuevo texto resetea draft, método y error", () => {
  let state = createInitialCaptureState();
  state = captureFlowReducer(state, { type: "submit_text_error", message: "error" });
  assert.equal(state.phase, CAPTURA_PHASES.ERROR);

  state = captureFlowReducer(state, { type: "submit_text_start" });
  assert.equal(state.phase, CAPTURA_PHASES.LOADING_DRAFT);
  assert.equal(state.errorMessage, "");
  assert.equal(state.selectedPaymentMethod, "");
  assert.equal(state.draft, null);
});
