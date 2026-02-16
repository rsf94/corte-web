"use client";

import { useEffect, useMemo, useState } from "react";
import { buildStackedChartData, getCardNames, getDefaultRange } from "../../lib/dashboard_cashflow.js";

const CARD_COLORS = ["#1d4ed8", "#9333ea", "#0f766e", "#ea580c", "#be123c", "#334155"];

function formatCurrency(value) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value || 0);
}

function isoToInputMonth(iso) {
  return iso?.slice(0, 7) ?? "";
}

function inputMonthToISO(inputMonth) {
  return `${inputMonth}-01`;
}

export default function CashflowTable({ initialData, initialFromISO = "", initialToISO = "" }) {
  const defaults = useMemo(() => getDefaultRange(), []);
  const [fromISO, setFromISO] = useState(initialFromISO || defaults.from);
  const [toISO, setToISO] = useState(initialToISO || defaults.to);
  const [draftFrom, setDraftFrom] = useState(isoToInputMonth(initialFromISO || defaults.from));
  const [draftTo, setDraftTo] = useState(isoToInputMonth(initialToISO || defaults.to));
  const [data, setData] = useState(initialData);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    async function run() {
      setIsLoading(true);
      setError("");

      try {
        const params = new URLSearchParams({ from: fromISO, to: toISO });
        const res = await fetch(`/api/cashflow?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal
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
          throw new Error(`Error ${res.status}`);
        }

        setData(await res.json());
      } catch (fetchError) {
        if (fetchError.name !== "AbortError") {
          setError(fetchError.message || "No se pudo actualizar la tabla");
        }
      } finally {
        setIsLoading(false);
      }
    }

    run();
    return () => controller.abort();
  }, [fromISO, toISO]);

  const monthColumns = data?.months ?? [];
  const cardNames = getCardNames(data);
  const chartData = buildStackedChartData(data, monthColumns);
  const maxTotal = Math.max(...chartData.map((point) => point.total), 1);

  return (
    <div className="mt-6">
      <form
        className="mb-4 flex flex-wrap items-end gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!draftFrom || !draftTo) return;
          setFromISO(inputMonthToISO(draftFrom));
          setToISO(inputMonthToISO(draftTo));
        }}
      >
        <label className="flex flex-col gap-1 text-sm">
          Desde
          <input
            className="rounded border border-slate-300 px-3 py-2"
            type="month"
            name="from"
            value={draftFrom}
            onChange={(event) => setDraftFrom(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Hasta
          <input
            className="rounded border border-slate-300 px-3 py-2"
            type="month"
            name="to"
            value={draftTo}
            onChange={(event) => setDraftTo(event.target.value)}
          />
        </label>
        <button className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white" type="submit">
          Aplicar
        </button>
      </form>

      {isLoading ? <p className="mb-3 text-xs text-slate-500">Actualizando…</p> : null}
      {error ? <p className="mb-3 text-xs text-red-600">{error}</p> : null}

      {data ? (
        <>
          <div className="overflow-x-auto rounded border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100 text-left">
                <tr>
                  <th className="px-4 py-3">Tarjeta</th>
                  {monthColumns.map((month) => (
                    <th key={month} className="px-4 py-3 text-right">{month}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.card_name} className="border-t border-slate-100">
                    <td className="px-4 py-3 font-medium">{row.card_name}</td>
                    {monthColumns.map((month) => (
                      <td key={month} className="px-4 py-3 text-right tabular-nums">
                        {formatCurrency(row.totals[month] ?? 0)}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="border-t border-slate-200 bg-slate-50 font-semibold">
                  <td className="px-4 py-3">TOTAL</td>
                  {monthColumns.map((month) => (
                    <td key={month} className="px-4 py-3 text-right tabular-nums">
                      {formatCurrency(data.totals[month] ?? 0)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>

          <div className="mt-6 rounded border border-slate-200 bg-white p-4 shadow-sm" data-testid="cashflow-chart">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">Gráfica por mes</h2>
            <div className="flex gap-6 overflow-x-auto pb-2">
              {chartData.map((point) => {
                const columnHeight = (point.total / maxTotal) * 220;
                return (
                  <div key={point.month} className="min-w-[96px] text-center">
                    <p className="mb-2 text-xs font-semibold text-slate-700">{formatCurrency(point.total)}</p>
                    <div className="mx-auto flex h-[220px] w-10 flex-col justify-end overflow-hidden rounded bg-slate-100">
                      <div className="flex flex-col" style={{ height: `${columnHeight}px` }}>
                        {cardNames.map((cardName, index) => {
                          const value = point[cardName] ?? 0;
                          if (!value || point.total <= 0) return null;
                          const segmentHeight = (value / point.total) * columnHeight;
                          return (
                            <div
                              key={`${point.month}-${cardName}`}
                              title={`${cardName}: ${formatCurrency(value)}`}
                              style={{
                                height: `${segmentHeight}px`,
                                backgroundColor: CARD_COLORS[index % CARD_COLORS.length]
                              }}
                            />
                          );
                        })}
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">{point.month}</p>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 flex flex-wrap gap-3 text-xs">
              {cardNames.map((cardName, index) => (
                <span key={cardName} className="inline-flex items-center gap-1 text-slate-700">
                  <span
                    aria-hidden="true"
                    className="inline-block h-2.5 w-2.5 rounded"
                    style={{ backgroundColor: CARD_COLORS[index % CARD_COLORS.length] }}
                  />
                  {cardName}
                </span>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
