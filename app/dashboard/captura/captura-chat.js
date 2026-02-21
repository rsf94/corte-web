"use client";

import { useEffect, useMemo, useState, useReducer } from "react";
import { CAPTURA_PHASES, captureFlowReducer, createInitialCaptureState, draftNeedsMsiMonths } from "../../../lib/captura_flow.js";

function formatMoney(value, currency = "MXN") {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency
  }).format(Number(value || 0));
}

function nowTimeLabel() {
  return new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
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
  if (!draftMethod || !Array.isArray(methods) || !methods.length) {
    return { selectedMethod: "", ambiguousMatches: [] };
  }

  const exactMatch = methods.find((method) => normalizeMethod(method) === draftMethod);
  if (exactMatch) return { selectedMethod: exactMatch, ambiguousMatches: [] };

  const partialMatches = methods.filter((method) => normalizeMethod(method).includes(draftMethod));
  if (partialMatches.length === 1) {
    return { selectedMethod: partialMatches[0], ambiguousMatches: [] };
  }

  if (partialMatches.length > 1) {
    return { selectedMethod: "", ambiguousMatches: partialMatches };
  }

  return { selectedMethod: "", ambiguousMatches: [] };
}

function pickContextPaymentMethods(body) {
  const suggestions = body?.suggestions ?? {};
  if (Array.isArray(suggestions.payment_methods)) return suggestions.payment_methods;
  if (Array.isArray(suggestions.paymentMethods)) return suggestions.paymentMethods;
  if (Array.isArray(body?.payment_methods)) return body.payment_methods;
  if (Array.isArray(body?.paymentMethods)) return body.paymentMethods;
  return [];
}

export default function CapturaChat() {
  const [messages, setMessages] = useState([
    { id: "sys-1", role: "system", text: "Hola. Escribe un gasto como: 230 uber o 140 autolavado a 3 MSI.", time: nowTimeLabel() }
  ]);
  const [text, setText] = useState("");
  const [flow, dispatch] = useReducer(captureFlowReducer, undefined, createInitialCaptureState);
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [trip, setTrip] = useState(null);
  const [includeTrip, setIncludeTrip] = useState(true);
  const [warning, setWarning] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadContext() {
      try {
        const res = await fetch("/api/expense-capture-context", { method: "GET", cache: "no-store" });
        if (!res.ok) return;
        const body = await res.json();
        if (cancelled) return;
        setTrip(body.active_trip ?? null);
        setPaymentMethods(pickContextPaymentMethods(body));
        if (body.active_trip && !body.active_trip.base_currency) {
          setWarning("Tu viaje no tiene moneda base configurada. Usaremos MXN por ahora.");
        }
      } catch {
        if (!cancelled) {
          setWarning("No pude cargar métodos de pago. Puedes intentar de nuevo.");
        }
      }
    }

    loadContext();
    return () => {
      cancelled = true;
    };
  }, []);

  const canConfirm = flow.phase === CAPTURA_PHASES.READY_TO_CONFIRM;
  const paymentMethodButtons = useMemo(() => paymentMethods, [paymentMethods]);

  async function sendText(event) {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || flow.phase === CAPTURA_PHASES.LOADING_DRAFT) return;

    setMessages((current) => [...current, { id: `u-${Date.now()}`, role: "user", text: trimmed, time: nowTimeLabel() }]);
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
      if (!res.ok) {
        throw new Error(body.error || "No pude interpretar el gasto");
      }

      dispatch({ type: "submit_text_success", draft: body.draft });
      const draftMethodResolution = resolveDraftMethod(body.draft, paymentMethodButtons);
      if (draftMethodResolution.selectedMethod) {
        dispatch({ type: "select_payment_method", paymentMethod: draftMethodResolution.selectedMethod });
      }

      const flowHint = draftMethodResolution.ambiguousMatches.length
        ? `Encontré varios métodos posibles (${draftMethodResolution.ambiguousMatches.join(", ")}). Elige uno para continuar.`
        : !draftMethodResolution.selectedMethod && paymentMethodButtons.length > 1
          ? "Elige tu método de pago para continuar."
          : body.ui?.message || "Revisa y confirma.";

      setMessages((current) => [...current, { id: `s-${Date.now()}`, role: "system", text: flowHint, time: nowTimeLabel() }]);
      setText("");
    } catch (error) {
      dispatch({ type: "submit_text_error", message: error.message });
      setMessages((current) => [...current, { id: `e-${Date.now()}`, role: "system", text: error.message || "No pude interpretar el gasto.", time: nowTimeLabel() }]);
    }
  }

  async function confirmExpense() {
    if (!flow.draft || !flow.selectedPaymentMethod || !canConfirm) return;

    dispatch({ type: "confirm_start" });
    try {
      const res = await fetch("/api/expenses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildConfirmPayload(flow.draft, flow.selectedPaymentMethod))
      });

      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error || "No se pudo guardar");
      }

      dispatch({ type: "confirm_success" });
      setMessages((current) => [...current, { id: `ok-${Date.now()}`, role: "system", text: "✅ Guardado", time: nowTimeLabel() }]);
    } catch (error) {
      dispatch({ type: "confirm_error", message: error.message });
      setMessages((current) => [...current, { id: `save-${Date.now()}`, role: "system", text: error.message || "No se pudo guardar", time: nowTimeLabel() }]);
    }
  }

  function cancelDraft() {
    dispatch({ type: "cancel" });
    setText("");
    setMessages((current) => [...current, { id: `cancel-${Date.now()}`, role: "system", text: "Borrador cancelado.", time: nowTimeLabel() }]);
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" data-testid="captura-chat">
      <div className="mb-4 h-[320px] space-y-3 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50 p-3">
        {messages.map((message) => (
          <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${message.role === "user" ? "bg-blue-600 text-white" : "bg-white text-slate-800"}`}>
              <p>{message.text}</p>
              <p className={`mt-1 text-[11px] ${message.role === "user" ? "text-blue-100" : "text-slate-400"}`}>{message.time}</p>
            </div>
          </div>
        ))}
      </div>

      {warning ? <p className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{warning}</p> : null}

      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          className={`rounded px-3 py-1.5 text-xs font-medium ${includeTrip ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-700"}`}
          onClick={() => setIncludeTrip(true)}
        >
          ✅ Es del viaje
        </button>
        <button
          type="button"
          className={`rounded px-3 py-1.5 text-xs font-medium ${!includeTrip ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-700"}`}
          onClick={() => setIncludeTrip(false)}
        >
          🚫 No es del viaje
        </button>
      </div>

      {flow.draft ? (
        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
          <p className="font-semibold text-slate-900">Confirma el gasto</p>
          <p className="mt-1 text-slate-700">Monto: {formatMoney(flow.draft.original_amount, flow.draft.original_currency)}</p>
          <p className="text-slate-700">Monto MXN: {formatMoney(flow.draft.amount_mxn, "MXN")}</p>
          <p className="text-slate-700">Fecha: {flow.draft.purchase_date}</p>
          <p className="text-slate-700">Descripción: {flow.draft.description || "-"}</p>
          <p className="text-slate-700">MSI: {flow.draft.is_msi ? `${flow.draft.msi_months || "?"} meses` : "No"}</p>

          <div className="mt-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Método de pago</p>
            {paymentMethodButtons.length ? (
              <div className="flex flex-wrap gap-2">
                {paymentMethodButtons.map((method) => (
                  <button
                    key={method}
                    type="button"
                    className={`rounded-full border px-3 py-1.5 text-xs ${flow.selectedPaymentMethod === method ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-300 bg-white text-slate-700"}`}
                    onClick={() => dispatch({ type: "select_payment_method", paymentMethod: method })}
                  >
                    {method}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-600">No encontramos métodos de pago todavía. Verifica tus cuentas vinculadas.</p>
            )}
          </div>

          {draftNeedsMsiMonths(flow.draft) && flow.selectedPaymentMethod ? (
            <div className="mt-3">
              <label htmlFor="msi-months" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Meses MSI</label>
              <input
                id="msi-months"
                type="number"
                min="1"
                step="1"
                value={flow.draft.msi_months ?? ""}
                onChange={(event) => dispatch({ type: "set_msi_months", months: event.target.value })}
                className="w-32 rounded border border-slate-300 px-2 py-1 text-xs"
                placeholder="Ej: 3"
              />
              <p className="mt-1 text-xs text-slate-500">Indica cuántos meses son para poder confirmar.</p>
            </div>
          ) : null}

          <div className="mt-4 flex gap-2">
            <button disabled={!canConfirm} type="button" onClick={confirmExpense} className="rounded bg-emerald-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">Confirmar</button>
            <button type="button" onClick={cancelDraft} className="rounded border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700">Cancelar</button>
          </div>
        </div>
      ) : null}

      <form onSubmit={sendText} className="flex gap-2">
        <input
          type="text"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="Ejemplo: 230 uber"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <button type="submit" disabled={flow.phase === CAPTURA_PHASES.LOADING_DRAFT} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">Enviar</button>
      </form>
    </section>
  );
}
