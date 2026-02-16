"use client";

import { useEffect, useRef, useState } from "react";

function formatCurrency(value) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value || 0);
}

export default function CashflowTable({
  months,
  initialData,
  fromISO,
  toISO,
  token = "",
  chatId = "",
  usingTokenFallback = false
}) {
  const [excludeMsi, setExcludeMsi] = useState(false);
  const [data, setData] = useState(initialData);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    const controller = new AbortController();

    async function run() {
      setIsLoading(true);
      setError("");

      try {
        const params = new URLSearchParams({
          from: fromISO,
          to: toISO,
          exclude_msi: String(excludeMsi)
        });
        if (usingTokenFallback) {
          params.set("token", token);
        }
        if (chatId) {
          params.set("chat_id", chatId);
        }

        const res = await fetch(`/api/cashflow?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal
        });

        if (!res.ok) {
          throw new Error(`Error ${res.status}`);
        }

        const json = await res.json();
        setData(json);
      } catch (fetchError) {
        if (fetchError.name !== "AbortError") {
          setError(fetchError.message || "No se pudo actualizar la tabla");
        }
      } finally {
        setIsLoading(false);
      }
    }

    run();

    return () => {
      controller.abort();
    };
  }, [excludeMsi, fromISO, toISO, token, chatId, usingTokenFallback]);

  if (!data) return null;

  const monthColumns = data.months ?? months;

  return (
    <div className="mt-6">
      <label className="mb-3 inline-flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={excludeMsi}
          onChange={(event) => setExcludeMsi(event.target.checked)}
        />
        Excluir MSI
      </label>

      {isLoading ? <p className="mb-3 text-xs text-slate-500">Actualizando…</p> : null}
      {error ? <p className="mb-3 text-xs text-red-600">{error}</p> : null}

      <div className="overflow-x-auto rounded border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100 text-left">
            <tr>
              <th className="px-4 py-3">Tarjeta</th>
              {monthColumns.map((month) => (
                <th key={month} className="px-4 py-3 text-right">
                  {month}
                </th>
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
    </div>
  );
}
