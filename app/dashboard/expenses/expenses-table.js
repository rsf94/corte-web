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
            <th className="px-4 py-3">Fecha</th>
            <th className="px-4 py-3">Tarjeta</th>
            <th className="px-4 py-3">Categoría</th>
            <th className="px-4 py-3">Comercio</th>
            <th className="px-4 py-3">Descripción</th>
            <th className="px-4 py-3 text-right">Monto</th>
            <th className="px-4 py-3 text-center">MSI</th>
            <th className="px-4 py-3 text-right">Meses MSI</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={`${item.id}-${item.created_at}`} className="border-t border-slate-100 align-top transition hover:bg-slate-50">
              <td className="whitespace-nowrap px-4 py-3">{formatDate(item.purchase_date)}</td>
              <td className="px-4 py-3">{item.payment_method || "-"}</td>
              <td className="px-4 py-3">{item.category || "-"}</td>
              <td className="px-4 py-3">{item.merchant || "-"}</td>
              <td className="max-w-[320px] px-4 py-3 text-slate-600">{item.description || "-"}</td>
              <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{formatCurrency(item.amount_mxn)} MXN</td>
              <td className="px-4 py-3 text-center">{item.is_msi ? "Sí" : "No"}</td>
              <td className="px-4 py-3 text-right tabular-nums">{item.msi_months ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
