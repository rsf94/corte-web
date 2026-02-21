export const CAPTURA_PHASES = {
  IDLE: "idle",
  LOADING_CONTEXT: "loadingContext",
  LOADING_DRAFT: "loadingDraft",
  AWAITING_PAYMENT_METHOD: "awaitingPaymentMethod",
  AWAITING_MSI_MONTHS: "awaitingMsiMonths",
  READY_TO_CONFIRM: "readyToConfirm",
  SAVING: "saving",
  DONE: "done",
  ERROR: "error"
};

function normalizePositiveInt(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export function draftNeedsMsiMonths(draft) {
  if (!draft?.is_msi) return false;
  return !normalizePositiveInt(draft?.msi_months);
}

export function resolveCapturePhase({ draft, selectedPaymentMethod, isSaving }) {
  if (isSaving) return CAPTURA_PHASES.SAVING;
  if (!draft) return CAPTURA_PHASES.IDLE;
  if (!selectedPaymentMethod) return CAPTURA_PHASES.AWAITING_PAYMENT_METHOD;
  if (draftNeedsMsiMonths(draft)) return CAPTURA_PHASES.AWAITING_MSI_MONTHS;
  return CAPTURA_PHASES.READY_TO_CONFIRM;
}

export function createInitialCaptureState() {
  return {
    phase: CAPTURA_PHASES.IDLE,
    draft: null,
    selectedPaymentMethod: "",
    isSaving: false,
    errorMessage: ""
  };
}

export function captureFlowReducer(state, action) {
  switch (action.type) {
    case "load_context_start":
      return {
        ...state,
        phase: CAPTURA_PHASES.LOADING_CONTEXT
      };
    case "load_context_done":
      return {
        ...state,
        phase: resolveCapturePhase({ draft: state.draft, selectedPaymentMethod: state.selectedPaymentMethod, isSaving: state.isSaving })
      };
    case "submit_text_start":
      return {
        ...createInitialCaptureState(),
        phase: CAPTURA_PHASES.LOADING_DRAFT
      };
    case "submit_text_success": {
      const draft = action.draft;
      return {
        ...state,
        draft,
        isSaving: false,
        errorMessage: "",
        selectedPaymentMethod: "",
        phase: resolveCapturePhase({ draft, selectedPaymentMethod: "", isSaving: false })
      };
    }
    case "submit_text_error":
      return {
        ...createInitialCaptureState(),
        phase: CAPTURA_PHASES.ERROR,
        errorMessage: action.message || "No pude interpretar el gasto."
      };
    case "select_payment_method": {
      const selectedPaymentMethod = String(action.paymentMethod || "");
      return {
        ...state,
        selectedPaymentMethod,
        phase: resolveCapturePhase({ draft: state.draft, selectedPaymentMethod, isSaving: false })
      };
    }
    case "set_msi_months": {
      if (!state.draft) return state;
      const nextDraft = {
        ...state.draft,
        msi_months: normalizePositiveInt(action.months)
      };
      return {
        ...state,
        draft: nextDraft,
        phase: resolveCapturePhase({ draft: nextDraft, selectedPaymentMethod: state.selectedPaymentMethod, isSaving: false })
      };
    }
    case "confirm_start":
      return { ...state, isSaving: true, phase: CAPTURA_PHASES.SAVING };
    case "confirm_error":
      return {
        ...state,
        isSaving: false,
        phase: resolveCapturePhase({ draft: state.draft, selectedPaymentMethod: state.selectedPaymentMethod, isSaving: false }),
        errorMessage: action.message || "No se pudo guardar"
      };
    case "confirm_success":
      return {
        ...createInitialCaptureState(),
        phase: CAPTURA_PHASES.DONE
      };
    case "reset_after_done":
    case "cancel":
      return createInitialCaptureState();
    default:
      return state;
  }
}
