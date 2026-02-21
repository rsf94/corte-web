"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { CAPTURA_PHASES, captureFlowReducer, createInitialCaptureState, draftNeedsMsiMonths } from "../../../lib/captura_flow.js";

function nowTimeLabel() {
  return new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
}

function formatMoney(value, currency = "MXN") {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency }).format(Number(value || 0));
}

function buildConfirmPayload(draft, selectedPaymentMethod) {
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
    trip_id: draft.trip_id || null
  };
}

function normalizeMethod(value) {
  return String(value || "").trim().toLowerCase();
}

function resolveDraftMethod(draft, methods) {
  const draftMethod = normalizeMethod(draft?.payment_method);
  if (!draftMethod || !methods.length) return { selectedMethod: "", ambiguousMatches: [] };

  const exactMatch = methods.find((method) => normalizeMethod(method.label) === draftMethod);
  if (exactMatch) return { selectedMethod: exactMatch.label, ambiguousMatches: [] };

  const partialMatches = methods.filter((method) => normalizeMethod(method.label).includes(draftMethod));
  if (partialMatches.length === 1) return { selectedMethod: partialMatches[0].label, ambiguousMatches: [] };
  if (partialMatches.length > 1) return { selectedMethod: "", ambiguousMatches: partialMatches.map((method) => method.label) };

  return { selectedMethod: "", ambiguousMatches: [] };
}

function buildDraftSummary(draft, selectedPaymentMethod) {
  const rows = [
    `Monto: ${formatMoney(draft.original_amount, draft.original_currency)}`,
    `MXN: ${formatMoney(draft.amount_mxn, "MXN")}`,
    `Descripción: ${draft.description || "-"}`,
    `Método: ${selectedPaymentMethod || "pendiente"}`,
    `MSI: ${draft.is_msi ? `${draft.msi_months || "?"} meses` : "No"}`
  ];
  return rows.join("\n");
}

export default function CapturaChat() {
  const [messages, setMessages] = useState([
    { id: "sys-1", role: "system", text: "Hola 👋 Soy tu bot de captura. Escribe algo como: 230 uber.", time: nowTimeLabel() }
  ]);
  const [text, setText] = useState("");
  const [flow, dispatch] = useReducer(captureFlowReducer, undefined, createInitialCaptureState);
  const [methods, setMethods] = useState([]);
  const [trip, setTrip] = useState(null);
  const [includeTrip, setIncludeTrip] = useState(true);
  const chatBodyRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function loadContext() {
      try {
        const res = await fetch("/api/expense-capture-context", { method: "GET", cache: "no-store" });
        if (!res.ok) return;
        const body = await res.json();
        if (cancelled) return;

        const contextMethods = Array.isArray(body.methods) ? body.methods : [];
        setMethods(contextMethods);
        setTrip(body.active_trip ?? null);
        setIncludeTrip(Boolean(body.hasTrip));
      } catch {
        if (!cancelled) {
          setMessages((current) => [...current, { id: `ctx-${Date.now()}`, role: "system", text: "No pude cargar contexto. Puedes seguir capturando.", time: nowTimeLabel() }]);
        }
      }
    }

    loadContext();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    chatBodyRef.current?.scrollTo({ top: chatBodyRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, flow.phase]);

  const methodButtons = useMemo(() => methods.map((method) => method.label), [methods]);
  const canSend = flow.phase !== CAPTURA_PHASES.LOADING_DRAFT && flow.phase !== CAPTURA_PHASES.SAVING;

  async function sendText(event) {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || !canSend) return;

    setMessages((current) => [...current, { id: `u-${Date.now()}`, role: "user", text: trimmed, time: nowTimeLabel() }]);
    setText("");
    dispatch({ type: "submit_text_start" });

    try {
      const res = await fetch("/api/expense-draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: trimmed,
          include_trip: includeTrip,
          trip_id: includeTrip ? trip?.id : "",
          trip_base_currency: includeTrip ? trip?.base_currency : ""
        })
      });

      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "No pude interpretar el gasto");

      dispatch({ type: "submit_text_success", draft: body.draft });
      const match = resolveDraftMethod(body.draft, methods);
      if (match.selectedMethod) dispatch({ type: "select_payment_method", paymentMethod: match.selectedMethod });

      const hint = match.ambiguousMatches.length
        ? `Veo varias opciones (${match.ambiguousMatches.join(", ")}). Elige método de pago.`
        : match.selectedMethod
          ? `Listo. Método detectado: ${match.selectedMethod}.`
          : "Listo. Elige método de pago para continuar.";

      setMessages((current) => [...current, { id: `sys-${Date.now()}`, role: "system", text: hint, time: nowTimeLabel() }]);
    } catch (error) {
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
        body: JSON.stringify(buildConfirmPayload(flow.draft, flow.selectedPaymentMethod))
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "No se pudo guardar");

      dispatch({ type: "confirm_success" });
      setMessages((current) => [...current, { id: `done-${Date.now()}`, role: "system", text: "Guardado ✅", time: nowTimeLabel() }]);
      dispatch({ type: "reset_after_done" });
    } catch (error) {
      dispatch({ type: "confirm_error", message: error.message });
      setMessages((current) => [...current, { id: `save-${Date.now()}`, role: "system", text: error.message || "No se pudo guardar", time: nowTimeLabel() }]);
    }
  }

  function cancelDraft() {
    dispatch({ type: "cancel" });
    setMessages((current) => [...current, { id: `cancel-${Date.now()}`, role: "system", text: "Cancelado.", time: nowTimeLabel() }]);
  }

  function setMsiMonths(months) {
    dispatch({ type: "set_msi_months", months: String(months) });
    setMessages((current) => [...current, { id: `msi-${Date.now()}`, role: "user", text: `${months} meses`, time: nowTimeLabel() }]);
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

        {flow.phase === CAPTURA_PHASES.AWAITING_PAYMENT_METHOD ? (
          <div className="flex flex-wrap gap-2">
            {methodButtons.length ? methodButtons.map((method) => (
              <button key={method} type="button" className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs" onClick={() => dispatch({ type: "select_payment_method", paymentMethod: method })}>
                {method}
              </button>
            )) : <p className="text-xs text-slate-600">Sin métodos aún. Vincula cuentas o usa otro método registrado.</p>}
            <button type="button" onClick={cancelDraft} className="rounded-full border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs text-rose-700">Cancelar</button>
          </div>
        ) : null}

        {flow.phase === CAPTURA_PHASES.AWAITING_MSI_MONTHS ? (
          <div className="space-y-2">
            <p className="text-xs text-slate-600">¿A cuántos meses?</p>
            <div className="flex flex-wrap gap-2">
              {[3, 6, 9, 12].map((months) => (
                <button key={months} type="button" className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs" onClick={() => setMsiMonths(months)}>
                  {months}
                </button>
              ))}
              <button type="button" onClick={cancelDraft} className="rounded-full border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs text-rose-700">Cancelar</button>
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

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className={`rounded-full px-3 py-1.5 text-xs ${includeTrip ? "bg-blue-100 text-blue-700" : "bg-slate-200 text-slate-700"}`}
          onClick={() => setIncludeTrip(true)}
        >
          Es del viaje
        </button>
        <button
          type="button"
          className={`rounded-full px-3 py-1.5 text-xs ${!includeTrip ? "bg-blue-100 text-blue-700" : "bg-slate-200 text-slate-700"}`}
          onClick={() => setIncludeTrip(false)}
        >
          No es del viaje
        </button>
      </div>

      <form onSubmit={sendText} className="mt-3 flex gap-2">
        <input
          type="text"
          className="flex-1 rounded-full border border-slate-300 px-4 py-2 text-sm"
          placeholder="Ejemplo: 230 uber"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <button type="submit" disabled={!canSend} className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">Enviar</button>
      </form>
    </section>
  );
}
