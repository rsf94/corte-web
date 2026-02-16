function formatCurrency(value) {
  return new Intl.NumberFormat("es-MX", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value || 0);
}

function formatDate(value) {
  if (!value) return "-";
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(parsed);
}

export default function ExpensesTable({ items }) {
  return (
    <div className="overflow-x-auto rounded border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full text-sm">
        <thead className="sticky top-0 z-10 bg-slate-100 text-left">
          <tr>
            <th className="px-4 py-3 text-xs uppercase tracking-wide text-slate-600">Fecha</th>
            <th className="px-4 py-3 text-xs uppercase tracking-wide text-slate-600">Tarjeta</th>
            <th className="px-4 py-3 text-xs uppercase tracking-wide text-slate-600">Categoría</th>
            <th className="px-4 py-3 text-xs uppercase tracking-wide text-slate-600">Comercio</th>
            <th className="px-4 py-3 text-xs uppercase tracking-wide text-slate-600">Descripción</th>
            <th className="px-4 py-3 text-right text-xs uppercase tracking-wide text-slate-600">Monto</th>
            <th className="px-4 py-3 text-center text-xs uppercase tracking-wide text-slate-600">MSI</th>
            <th className="px-4 py-3 text-right text-xs uppercase tracking-wide text-slate-600">Meses MSI</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr
              key={`${item.id}-${item.created_at}`}
              className={`align-top transition-colors duration-200 hover:bg-gray-50 ${
                index % 2 === 0 ? "bg-white" : "bg-slate-50/40"
              }`}
            >
              <td className="whitespace-nowrap border-t border-slate-100 px-4 py-4">{formatDate(item.purchase_date)}</td>
              <td className="border-t border-slate-100 px-4 py-4">{item.payment_method || "-"}</td>
              <td className="border-t border-slate-100 px-4 py-4">{item.category || "-"}</td>
              <td className="border-t border-slate-100 px-4 py-4">{item.merchant || "-"}</td>
              <td className="max-w-[320px] border-t border-slate-100 px-4 py-4 text-slate-600">{item.description || "-"}</td>
              <td className="whitespace-nowrap border-t border-slate-100 px-4 py-4 text-right tabular-nums">{formatCurrency(item.amount_mxn)} MXN</td>
              <td className="border-t border-slate-100 px-4 py-4 text-center">{item.is_msi ? "Sí" : "No"}</td>
              <td className="border-t border-slate-100 px-4 py-4 text-right tabular-nums">{item.msi_months ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
