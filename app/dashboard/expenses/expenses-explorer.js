"use client";

import { useEffect, useMemo, useState } from "react";
import { buildExpensesQueryParams, getDefaultExpensesDateRange } from "../../../lib/dashboard_expenses.js";
import ExpensesFilters from "./expenses-filters.js";
import ExpensesTable from "./expenses-table.js";

const PAGE_SIZE = 50;

function uniqueSortedValues(items, key) {
  return Array.from(new Set(items.map((item) => item[key]).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function emptyExpenseForm(defaultDate) {
  return {
    purchase_date: defaultDate,
    amount: "",
    currency: "MXN",
    payment_method: "",
    category: "",
    merchant: "",
    description: ""
  };
}

export default function ExpensesExplorer() {
  const defaults = useMemo(() => getDefaultExpensesDateRange(), []);
  const [draft, setDraft] = useState({
    from: defaults.from,
    to: defaults.to,
    payment_method: "",
    category: "",
    q: "",
    is_msi: "all"
  });
  const [activeFilters, setActiveFilters] = useState({ ...draft });
  const [items, setItems] = useState([]);
  const [nextCursor, setNextCursor] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [hasFetched, setHasFetched] = useState(false);
  const [showNewExpense, setShowNewExpense] = useState(false);
  const [newExpense, setNewExpense] = useState(() => emptyExpenseForm(defaults.to));
  const [isSavingExpense, setIsSavingExpense] = useState(false);
  const [saveError, setSaveError] = useState("");

  const paymentMethods = useMemo(() => uniqueSortedValues(items, "payment_method"), [items]);
  const categories = useMemo(() => uniqueSortedValues(items, "category"), [items]);

  async function runFetch({ append = false, cursor = "", filters = activeFilters }) {
    setIsLoading(true);
    setError("");

    try {
      const params = buildExpensesQueryParams(filters, {
        cursor,
        limit: PAGE_SIZE
      });
      const res = await fetch(`/api/expenses?${params.toString()}`, {
        method: "GET",
        cache: "no-store"
      });

      if (res.status === 401) {
        window.location.assign("/login");
        return;
      }

      if (res.status === 403) {
        window.location.assign("/unauthorized");
        return;
      }

      if (!res.ok) {
        throw new Error(`Error ${res.status} al cargar gastos`);
      }

      const body = await res.json();
      setItems((prev) => (append ? [...prev, ...(body.items ?? [])] : body.items ?? []));
      setNextCursor(body.next_cursor ?? "");
      setHasFetched(true);
    } catch (fetchError) {
      setError(fetchError.message || "No se pudieron cargar gastos");
    } finally {
      setIsLoading(false);
    }
  }

  async function submitNewExpense(event) {
    event.preventDefault();
    setIsSavingExpense(true);
    setSaveError("");

    try {
      const res = await fetch("/api/expenses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...newExpense,
          amount: Number(newExpense.amount)
        })
      });

      if (res.status === 401) {
        window.location.assign("/login");
        return;
      }

      if (res.status === 403) {
        window.location.assign("/unauthorized");
        return;
      }

      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error || "No se pudo registrar el gasto");
      }

      setShowNewExpense(false);
      setNewExpense(emptyExpenseForm(defaults.to));
      await runFetch({ append: false, cursor: "", filters: activeFilters });
    } catch (submitError) {
      setSaveError(submitError.message || "No se pudo registrar el gasto");
    } finally {
      setIsSavingExpense(false);
    }
  }

  useEffect(() => {
    runFetch({ append: false, cursor: "", filters: activeFilters });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="space-y-6" data-testid="expenses-explorer">
      <div className="flex justify-end">
        <button
          className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500"
          type="button"
          onClick={() => setShowNewExpense((current) => !current)}
        >
          + Nuevo gasto
        </button>
      </div>

      {showNewExpense ? (
        <form className="grid gap-3 rounded border border-slate-200 bg-white p-4" onSubmit={submitNewExpense}>
          <p className="text-sm font-semibold text-slate-700">Registrar gasto</p>
          <div className="grid gap-3 md:grid-cols-2">
            <input required type="date" value={newExpense.purchase_date} onChange={(event) => setNewExpense((current) => ({ ...current, purchase_date: event.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" aria-label="Fecha" />
            <input required type="number" step="0.01" min="0" value={newExpense.amount} onChange={(event) => setNewExpense((current) => ({ ...current, amount: event.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" placeholder="Monto" />
            <input type="text" value={newExpense.currency} onChange={(event) => setNewExpense((current) => ({ ...current, currency: event.target.value.toUpperCase() }))} className="rounded border border-slate-300 px-3 py-2 text-sm" placeholder="Moneda (MXN)" />
            <input required type="text" value={newExpense.payment_method} onChange={(event) => setNewExpense((current) => ({ ...current, payment_method: event.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" placeholder="Método de pago" />
            <input required type="text" value={newExpense.category} onChange={(event) => setNewExpense((current) => ({ ...current, category: event.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" placeholder="Categoría" />
            <input type="text" value={newExpense.merchant} onChange={(event) => setNewExpense((current) => ({ ...current, merchant: event.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" placeholder="Comercio" />
          </div>
          <textarea value={newExpense.description} onChange={(event) => setNewExpense((current) => ({ ...current, description: event.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" placeholder="Descripción" rows={3} />
          {saveError ? <p className="text-xs text-red-600">{saveError}</p> : null}
          <div className="flex gap-2">
            <button disabled={isSavingExpense} className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60" type="submit">Guardar gasto</button>
            <button className="rounded border border-slate-300 px-4 py-2 text-sm" type="button" onClick={() => setShowNewExpense(false)}>Cancelar</button>
          </div>
        </form>
      ) : null}

      <ExpensesFilters
        draft={draft}
        paymentMethods={paymentMethods}
        categories={categories}
        isLoading={isLoading}
        onDraftChange={(field, value) => setDraft((current) => ({ ...current, [field]: value }))}
        onApply={() => {
          setActiveFilters({ ...draft });
          runFetch({ append: false, cursor: "", filters: { ...draft } });
        }}
      />

      {isLoading ? <p className="text-xs text-slate-500">Cargando…</p> : null}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}

      {hasFetched && !items.length && !isLoading ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded border border-slate-200 bg-slate-50 px-6 py-10 text-center text-sm text-slate-600">
          <span aria-hidden="true" className="text-xl">◌</span>
          <p>Aún no tienes gastos en web. Puedes registrar uno aquí o vincular Telegram.</p>
        </div>
      ) : null}

      {items.length ? <ExpensesTable items={items} /> : null}

      {nextCursor ? (
        <div>
          <button
            className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
            type="button"
            onClick={() => runFetch({ append: true, cursor: nextCursor, filters: activeFilters })}
            disabled={isLoading}
          >
            Cargar más
          </button>
        </div>
      ) : null}
    </section>
  );
}
