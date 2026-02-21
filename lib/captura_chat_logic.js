import { CAPTURA_PHASES } from "./captura_flow.js";

export function nowTimeLabel() {
  return new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
}

export function createWelcomeMessage() {
  return { id: "sys-1", role: "system", text: "Hola 👋 Soy tu bot de captura. Escribe algo como: 230 uber.", time: nowTimeLabel() };
}

function normalizeMethod(value) {
  return String(value || "").trim().toLowerCase();
}

export function resolveDraftMethod(draft, methods) {
  const draftMethod = normalizeMethod(draft?.payment_method);
  if (!draftMethod || !methods.length) return { selectedMethod: "", ambiguousMatches: [] };

  const exactMatch = methods.find((method) => normalizeMethod(method.label) === draftMethod);
  if (exactMatch) return { selectedMethod: exactMatch.label, ambiguousMatches: [] };

  const partialMatches = methods.filter((method) => normalizeMethod(method.label).includes(draftMethod));
  if (partialMatches.length === 1) return { selectedMethod: partialMatches[0].label, ambiguousMatches: [] };
  if (partialMatches.length > 1) return { selectedMethod: "", ambiguousMatches: partialMatches.map((method) => method.label) };

  return { selectedMethod: "", ambiguousMatches: [] };
}

export function createMethodHint(match) {
  if (match.ambiguousMatches.length) {
    return `Veo varias opciones (${match.ambiguousMatches.join(", ")}). Elige método de pago.`;
  }
  if (match.selectedMethod) return `Listo. Método detectado: ${match.selectedMethod}.`;
  return "Listo. Elige método de pago para continuar.";
}

export function shouldShowTripQuickReplies({ draft, hasActiveTrip }) {
  return Boolean(draft && hasActiveTrip);
}

export function isDevOrTest() {
  return process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
}

export function logCaptureDecision(reason, payload) {
  if (!isDevOrTest()) return;
  console.log("capture_flow_decision", {
    reason,
    phase: payload.phase || CAPTURA_PHASES.IDLE,
    draft_msi: Boolean(payload.draft?.is_msi),
    draft_msi_months: payload.draft?.msi_months ?? null,
    hasTrip: Boolean(payload.hasTrip),
    activeTripId: payload.activeTripId || null,
    methods_count: Number(payload.methodsCount || 0),
    source_counts: payload.sourceCounts || { user: 0, chat: 0, merged: Number(payload.methodsCount || 0) },
    selectedMethodId: payload.selectedMethodId || ""
  });
}
