"use client";

import { useEffect, useMemo, useState } from "react";
import { buildExpensesQueryParams, getDefaultExpensesDateRange } from "../../../lib/dashboard_expenses.js";
import ExpensesFilters from "./expenses-filters.js";
import ExpensesTable from "./expenses-table.js";

const PAGE_SIZE = 50;

function uniqueSortedValues(items, key) {
  return Array.from(new Set(items.map((item) => item[key]).filter(Boolean))).sort((a, b) => a.localeCompare(b));
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

  useEffect(() => {
    runFetch({ append: false, cursor: "", filters: activeFilters });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="space-y-6" data-testid="expenses-explorer">
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
          <p>No se encontraron gastos con los filtros seleccionados.</p>
        </div>
      ) : null}

      {items.length ? <ExpensesTable items={items} /> : null}

      {nextCursor ? (
        <div>
          <button
            className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors duration-200 hover:bg-slate-100 disabled:opacity-60"
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
