"use client";

import { useEffect, useMemo, useState } from "react";

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

export default function CapturaChat() {
  const [messages, setMessages] = useState([
    { id: "sys-1", role: "system", text: "Hola. Escribe un gasto como: 230 uber o 140 autolavado a 3 MSI.", time: nowTimeLabel() }
  ]);
  const [text, setText] = useState("");
  const [draft, setDraft] = useState(null);
  const [isLoadingDraft, setIsLoadingDraft] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState("");
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
        setPaymentMethods(body.suggestions?.payment_methods ?? []);
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

  const canConfirm = Boolean(draft && selectedPaymentMethod && !isSaving);
  const paymentMethodButtons = useMemo(() => paymentMethods, [paymentMethods]);

  async function sendText(event) {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || isLoadingDraft) return;

    setMessages((current) => [...current, { id: `u-${Date.now()}`, role: "user", text: trimmed, time: nowTimeLabel() }]);
    setIsLoadingDraft(true);
    setDraft(null);
    setSelectedPaymentMethod("");

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

      setDraft(body.draft);
      setMessages((current) => [...current, { id: `s-${Date.now()}`, role: "system", text: body.ui?.message || "Revisa y confirma.", time: nowTimeLabel() }]);
      setText("");
    } catch (error) {
      setMessages((current) => [...current, { id: `e-${Date.now()}`, role: "system", text: error.message || "No pude interpretar el gasto.", time: nowTimeLabel() }]);
    } finally {
      setIsLoadingDraft(false);
    }
  }

  async function confirmExpense() {
    if (!draft || !selectedPaymentMethod) return;

    setIsSaving(true);
    try {
      const res = await fetch("/api/expenses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildConfirmPayload(draft, selectedPaymentMethod))
      });

      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error || "No se pudo guardar");
      }

      setMessages((current) => [...current, { id: `ok-${Date.now()}`, role: "system", text: "✅ Guardado", time: nowTimeLabel() }]);
      setDraft(null);
      setSelectedPaymentMethod("");
    } catch (error) {
      setMessages((current) => [...current, { id: `save-${Date.now()}`, role: "system", text: error.message || "No se pudo guardar", time: nowTimeLabel() }]);
    } finally {
      setIsSaving(false);
    }
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

      {draft ? (
        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
          <p className="font-semibold text-slate-900">Confirma el gasto</p>
          <p className="mt-1 text-slate-700">Monto: {formatMoney(draft.original_amount, draft.original_currency)}</p>
          <p className="text-slate-700">Monto MXN: {formatMoney(draft.amount_mxn, "MXN")}</p>
          <p className="text-slate-700">Fecha: {draft.purchase_date}</p>
          <p className="text-slate-700">Descripción: {draft.description || "-"}</p>
          <p className="text-slate-700">MSI: {draft.is_msi ? `${draft.msi_months} meses` : "No"}</p>

          <div className="mt-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Método de pago</p>
            {paymentMethodButtons.length ? (
              <div className="flex flex-wrap gap-2">
                {paymentMethodButtons.map((method) => (
                  <button
                    key={method}
                    type="button"
                    className={`rounded-full border px-3 py-1.5 text-xs ${selectedPaymentMethod === method ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-300 bg-white text-slate-700"}`}
                    onClick={() => setSelectedPaymentMethod(method)}
                  >
                    {method}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-600">No encontramos métodos de pago. Pronto podrás configurarlos.</p>
            )}
          </div>

          <div className="mt-4 flex gap-2">
            <button disabled={!canConfirm} type="button" onClick={confirmExpense} className="rounded bg-emerald-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">Confirmar</button>
            <button type="button" onClick={() => { setDraft(null); setSelectedPaymentMethod(""); }} className="rounded border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700">Cancelar</button>
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
        <button type="submit" disabled={isLoadingDraft} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">Enviar</button>
      </form>
    </section>
  );
}
