"use client";

import Link from "next/link";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { CAPTURA_PHASES, captureFlowReducer, createInitialCaptureState } from "../../../lib/captura_flow.js";
import {
  createMethodHint,
  createWelcomeMessage,
  logCaptureDecision,
  nowTimeLabel,
  resolveDraftMethod,
  shouldShowTripQuickReplies
} from "../../../lib/captura_chat_logic.js";

function formatMoney(value, currency = "MXN") {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency }).format(Number(value || 0));
}

function buildConfirmPayload(draft, selectedPaymentMethod, includeTrip) {
  return {
    purchase_date: draft.purchase_date,
    amount: draft.original_amount,
    currency: draft.original_currency,
    payment_method: selectedPaymentMethod,
    category: draft.category || "General",
    merchant: draft.merchant || "",
    description: draft.description || "",
    is_msi: draft.is_msi,
    msi_months: draft.msi_months,
    trip_id: includeTrip ? (draft.trip_id || null) : null
  };
}

function buildDraftSummary(draft, selectedPaymentMethod) {
  return [
    `Monto: ${formatMoney(draft.original_amount, draft.original_currency)}`,
    `MXN: ${formatMoney(draft.amount_mxn, "MXN")}`,
    `Descripción: ${draft.description || "-"}`,
    `Método: ${selectedPaymentMethod || "pendiente"}`,
    `MSI: ${draft.is_msi ? `${draft.msi_months || "?"} meses` : "No"}`
  ].join("\n");
}

export default function CapturaChat() {
  const [messages, setMessages] = useState([createWelcomeMessage()]);
  const [text, setText] = useState("");
  const [flow, dispatch] = useReducer(captureFlowReducer, undefined, createInitialCaptureState);
  const [methods, setMethods] = useState([]);
  const [trip, setTrip] = useState(null);
  const [hasActiveTrip, setHasActiveTrip] = useState(false);
  const [contextSourceCounts, setContextSourceCounts] = useState({ user: 0, chat: 0, merged: 0 });
  const [includeTrip, setIncludeTrip] = useState(false);
  const chatBodyRef = useRef(null);
  const draftRequestRef = useRef(null);
  const requestIdRef = useRef(0);
  const phaseRef = useRef(flow.phase);

  useEffect(() => {
    const controller = new AbortController();
    dispatch({ type: "load_context_start" });

    async function loadContext() {
      try {
        const res = await fetch("/api/expense-capture-context", { method: "GET", cache: "no-store", signal: controller.signal });
        if (!res.ok) throw new Error("No pude cargar contexto");
        const body = await res.json();
        const contextMethods = Array.isArray(body.methods) ? body.methods : [];
        const sourceCounts = {
          user: Number(body?.defaults?.source_counts?.user ?? 0),
          chat: Number(body?.defaults?.source_counts?.chat ?? 0),
          merged: Number(body?.defaults?.source_counts?.merged ?? contextMethods.length)
        };
        const activeTrip = body.active_trip ?? null;
        const backendHasTrip = Boolean(body.hasTrip || body.activeTripId || activeTrip?.id);

        setMethods(contextMethods);
        setContextSourceCounts(sourceCounts);
        setTrip(activeTrip);
        setHasActiveTrip(backendHasTrip);
        setIncludeTrip(backendHasTrip);
        dispatch({ type: "load_context_done" });

        logCaptureDecision("context_loaded", {
          phase: flow.phase,
          draft: flow.draft,
          hasTrip: backendHasTrip,
          activeTripId: backendHasTrip ? (body.activeTripId || activeTrip?.id || "") : "",
          methodsCount: contextMethods.length,
          sourceCounts,
          selectedMethodLabel: flow.selectedPaymentMethod
        });
      } catch {
        if (!controller.signal.aborted) {
          dispatch({ type: "load_context_done" });
          setMessages((current) => [...current, { id: `ctx-${Date.now()}`, role: "system", text: "No pude cargar contexto. Puedes seguir capturando.", time: nowTimeLabel() }]);
        }
      }
    }

    loadContext();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    chatBodyRef.current?.scrollTo({ top: chatBodyRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, flow.phase]);

  useEffect(() => {
    const previous = phaseRef.current;
    if (previous !== flow.phase) {
      logCaptureDecision("state_transition", {
        transition: `${previous}->${flow.phase}`,
        phase: flow.phase,
        draft: flow.draft,
        hasTrip: hasActiveTrip,
        activeTripId: hasActiveTrip ? (trip?.id || "") : "",
        sourceCounts: contextSourceCounts,
        methodsCount: methods.length,
        selectedMethodLabel: flow.selectedPaymentMethod
      });
      phaseRef.current = flow.phase;
    }
  }, [contextSourceCounts, flow.draft, flow.phase, flow.selectedPaymentMethod, hasActiveTrip, methods.length, trip]);

  const methodButtons = useMemo(() => methods.map((method) => method.label), [methods]);
  const showTripQuickReplies = hasActiveTrip && shouldShowTripQuickReplies({ draft: flow.draft, hasActiveTrip });
  const canPickMethod = Boolean(flow.draft) && flow.phase !== CAPTURA_PHASES.LOADING_DRAFT && flow.phase !== CAPTURA_PHASES.SAVING;
  const shouldShowMethodEmpty = Boolean(flow.draft) && methodButtons.length === 0;
  const canSend = flow.phase !== CAPTURA_PHASES.LOADING_DRAFT && flow.phase !== CAPTURA_PHASES.SAVING;

  async function sendText(event) {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || !canSend) return;

    if (draftRequestRef.current) draftRequestRef.current.abort();
    const controller = new AbortController();
    draftRequestRef.current = controller;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    setMessages((current) => [...current, { id: `u-${Date.now()}`, role: "user", text: trimmed, time: nowTimeLabel() }]);
    setText("");
    setIncludeTrip(hasActiveTrip);
    dispatch({ type: "submit_text_start" });

    try {
      const res = await fetch("/api/expense-draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          text: trimmed,
          include_trip: hasActiveTrip,
          trip_id: hasActiveTrip ? trip?.id : "",
          trip_base_currency: hasActiveTrip ? trip?.base_currency : ""
        })
      });

      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "No pude interpretar el gasto");
      if (requestId !== requestIdRef.current) return;

      const normalizedDraft = hasActiveTrip ? body.draft : { ...body.draft, trip_id: null };
      dispatch({ type: "submit_text_success", draft: normalizedDraft });

      const match = resolveDraftMethod(normalizedDraft, methods);
      if (match.selectedMethod) dispatch({ type: "select_payment_method", paymentMethod: match.selectedMethod });

      setMessages((current) => [...current, { id: `sys-${Date.now()}`, role: "system", text: createMethodHint(match), time: nowTimeLabel() }]);
      logCaptureDecision("draft_parsed", {
        phase: match.selectedMethod ? CAPTURA_PHASES.READY_TO_CONFIRM : CAPTURA_PHASES.AWAITING_PAYMENT_METHOD,
        draft: normalizedDraft,
        hasTrip: hasActiveTrip,
        activeTripId: hasActiveTrip ? (trip?.id || "") : "",
        methodsCount: methods.length,
        sourceCounts: contextSourceCounts,
        selectedMethodLabel: match.selectedMethod
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      dispatch({ type: "submit_text_error", message: error.message });
      setMessages((current) => [...current, { id: `err-${Date.now()}`, role: "system", text: error.message || "No pude interpretar el gasto.", time: nowTimeLabel() }]);
    }
  }

  async function confirmExpense() {
    if (!flow.draft || !flow.selectedPaymentMethod || flow.phase !== CAPTURA_PHASES.READY_TO_CONFIRM) return;
    dispatch({ type: "confirm_start" });

    try {
      const res = await fetch("/api/expenses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildConfirmPayload(flow.draft, flow.selectedPaymentMethod, hasActiveTrip && includeTrip))
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "No se pudo guardar");

      dispatch({ type: "confirm_success" });
      setIncludeTrip(hasActiveTrip);
      setMessages((current) => [...current, { id: `done-${Date.now()}`, role: "system", text: "Guardado ✅", time: nowTimeLabel() }]);
      setTimeout(() => dispatch({ type: "reset_after_done" }), 1000);
    } catch (error) {
      dispatch({ type: "confirm_error", message: error.message });
      setMessages((current) => [...current, { id: `save-${Date.now()}`, role: "system", text: error.message || "No se pudo guardar", time: nowTimeLabel() }]);
    }
  }

  function cancelDraft() {
    if (draftRequestRef.current) draftRequestRef.current.abort();
    requestIdRef.current += 1;
    dispatch({ type: "cancel" });
    setIncludeTrip(hasActiveTrip);
    setMessages((current) => [...current, { id: `cancel-${Date.now()}`, role: "system", text: "Cancelado.", time: nowTimeLabel() }]);
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm" data-testid="captura-chat">
      <div ref={chatBodyRef} className="h-[460px] space-y-3 overflow-y-auto rounded-xl bg-slate-50 p-3">
        {messages.map((message) => (
          <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[88%] whitespace-pre-line rounded-2xl px-3 py-2 text-sm ${message.role === "user" ? "bg-blue-600 text-white" : "bg-white text-slate-800"}`}>
              <p>{message.text}</p>
              <p className={`mt-1 text-[11px] ${message.role === "user" ? "text-blue-100" : "text-slate-400"}`}>{message.time}</p>
            </div>
          </div>
        ))}

        {flow.draft ? (
          <div className="flex justify-start">
            <div className="max-w-[88%] whitespace-pre-line rounded-2xl bg-white px-3 py-2 text-sm text-slate-800">
              <p>{buildDraftSummary(flow.draft, flow.selectedPaymentMethod)}</p>
            </div>
          </div>
        ) : null}

        {showTripQuickReplies ? (
          <div className="space-y-1">
            <p className="text-xs text-slate-600">¿Este gasto pertenece al viaje activo?</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={`rounded-full px-3 py-1.5 text-xs ${includeTrip ? "bg-blue-100 text-blue-700" : "bg-slate-200 text-slate-700"}`} onClick={() => setIncludeTrip(true)}>Es del viaje</button>
              <button type="button" className={`rounded-full px-3 py-1.5 text-xs ${!includeTrip ? "bg-blue-100 text-blue-700" : "bg-slate-200 text-slate-700"}`} onClick={() => setIncludeTrip(false)}>No es del viaje</button>
            </div>
          </div>
        ) : null}

        {flow.draft ? (
          <div className="flex flex-wrap gap-2">
            {methodButtons.map((method) => (
              <button key={method} type="button" className={`rounded-full border px-3 py-1.5 text-xs ${flow.selectedPaymentMethod === method ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-300 bg-white"}`} onClick={() => dispatch({ type: "select_payment_method", paymentMethod: method })} disabled={!canPickMethod}>{method}</button>
            ))}

            {shouldShowMethodEmpty ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <p>No encontramos métodos de pago. Crea tus cuentas primero.</p>
                <Link className="mt-1 inline-block font-semibold underline" href="/dashboard">Ir a /dashboard</Link>
              </div>
            ) : null}

            {(flow.phase === CAPTURA_PHASES.AWAITING_PAYMENT_METHOD || flow.phase === CAPTURA_PHASES.AWAITING_MSI_MONTHS || flow.phase === CAPTURA_PHASES.READY_TO_CONFIRM) ? (
              <button type="button" onClick={cancelDraft} className="rounded-full border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs text-rose-700">Cancelar</button>
            ) : null}
          </div>
        ) : null}

        {flow.phase === CAPTURA_PHASES.AWAITING_MSI_MONTHS ? (
          <div className="space-y-2">
            <p className="text-xs text-slate-600">¿A cuántos meses?</p>
            <div className="flex flex-wrap gap-2">
              {[3, 6, 9, 12].map((months) => (
                <button key={months} type="button" className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs" onClick={() => dispatch({ type: "set_msi_months", months: String(months) })}>{months}</button>
              ))}
            </div>
          </div>
        ) : null}

        {flow.phase === CAPTURA_PHASES.READY_TO_CONFIRM ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={confirmExpense} className="rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white">Confirmar</button>
            <button type="button" onClick={cancelDraft} className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs">Cancelar</button>
          </div>
        ) : null}
      </div>

      <form onSubmit={sendText} className="mt-3 flex gap-2">
        <input type="text" className="flex-1 rounded-full border border-slate-300 px-4 py-2 text-sm" placeholder="Ejemplo: 230 uber" value={text} onChange={(event) => setText(event.target.value)} />
        <button type="submit" disabled={!canSend} className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">Enviar</button>
      </form>
    </section>
  );
}
