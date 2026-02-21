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

test("happy path normal: draft -> método -> confirmar", () => {
  let state = createInitialCaptureState();
  state = captureFlowReducer(state, { type: "submit_text_success", draft: baseDraft });
  assert.equal(state.phase, CAPTURA_PHASES.AWAITING_PAYMENT_METHOD);

  state = captureFlowReducer(state, { type: "select_payment_method", paymentMethod: "Amex Gold" });
  assert.equal(state.phase, CAPTURA_PHASES.READY_TO_CONFIRM);

  state = captureFlowReducer(state, { type: "confirm_start" });
  assert.equal(state.phase, CAPTURA_PHASES.SAVING);

  state = captureFlowReducer(state, { type: "confirm_success" });
  assert.equal(state.phase, CAPTURA_PHASES.DONE);

  state = captureFlowReducer(state, { type: "reset_after_done" });
  assert.deepEqual(state, createInitialCaptureState());
});

test("happy path MSI con meses explícitos no pregunta meses", () => {
  const explicitMsiDraft = { ...baseDraft, is_msi: true, msi_months: 3 };

  assert.equal(draftNeedsMsiMonths(explicitMsiDraft), false);

  let state = createInitialCaptureState();
  state = captureFlowReducer(state, { type: "submit_text_success", draft: explicitMsiDraft });
  state = captureFlowReducer(state, { type: "select_payment_method", paymentMethod: "BBVA Azul" });

  assert.equal(state.phase, CAPTURA_PHASES.READY_TO_CONFIRM);
});

test("MSI sin meses pide meses, permite setear y confirmar", () => {
  const missingMsiMonthsDraft = { ...baseDraft, is_msi: true, msi_months: null };

  assert.equal(draftNeedsMsiMonths(missingMsiMonthsDraft), true);

  let state = createInitialCaptureState();
  state = captureFlowReducer(state, { type: "submit_text_success", draft: missingMsiMonthsDraft });
  state = captureFlowReducer(state, { type: "select_payment_method", paymentMethod: "Amex" });

  assert.equal(state.phase, CAPTURA_PHASES.AWAITING_MSI_MONTHS);

  state = captureFlowReducer(state, { type: "set_msi_months", months: "6" });
  assert.equal(state.phase, CAPTURA_PHASES.READY_TO_CONFIRM);
  assert.equal(state.draft.msi_months, 6);
});

test("cancelar desde cualquier fase limpia estado completo", () => {
  const cancellableStates = [
    captureFlowReducer(createInitialCaptureState(), { type: "submit_text_start" }),
    captureFlowReducer(createInitialCaptureState(), { type: "submit_text_success", draft: baseDraft }),
    captureFlowReducer(
      captureFlowReducer(createInitialCaptureState(), { type: "submit_text_success", draft: { ...baseDraft, is_msi: true } }),
      { type: "select_payment_method", paymentMethod: "Visa" }
    ),
    captureFlowReducer(
      captureFlowReducer(
        captureFlowReducer(createInitialCaptureState(), { type: "submit_text_success", draft: baseDraft }),
        { type: "select_payment_method", paymentMethod: "Visa" }
      ),
      { type: "confirm_start" }
    )
  ];

  for (const state of cancellableStates) {
    const cancelled = captureFlowReducer(state, { type: "cancel" });
    assert.deepEqual(cancelled, createInitialCaptureState());
  }
});

test("nuevo texto durante awaitingPaymentMethod resetea y crea nuevo draft", () => {
  let state = createInitialCaptureState();
  state = captureFlowReducer(state, { type: "submit_text_success", draft: baseDraft });
  state = captureFlowReducer(state, { type: "select_payment_method", paymentMethod: "Debito" });

  state = captureFlowReducer(state, { type: "submit_text_start" });
  assert.equal(state.phase, CAPTURA_PHASES.LOADING_DRAFT);
  assert.equal(state.selectedPaymentMethod, "");
  assert.equal(state.draft, null);

  const newDraft = { ...baseDraft, original_amount: 100, description: "uber" };
  state = captureFlowReducer(state, { type: "submit_text_success", draft: newDraft });
  assert.equal(state.phase, CAPTURA_PHASES.AWAITING_PAYMENT_METHOD);
  assert.equal(state.draft.description, "uber");
});


test("loadingContext -> done regresa a idle sin romper flujo", () => {
  let state = createInitialCaptureState();
  state = captureFlowReducer(state, { type: "load_context_start" });
  assert.equal(state.phase, CAPTURA_PHASES.LOADING_CONTEXT);

  state = captureFlowReducer(state, { type: "load_context_done" });
  assert.equal(state.phase, CAPTURA_PHASES.IDLE);
});
