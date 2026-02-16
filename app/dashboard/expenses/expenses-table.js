function formatCurrency(value) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value || 0);
}

export default function ExpensesTable({ items }) {
  return (
    <div className="overflow-x-auto rounded border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-100 text-left">
          <tr>
            <th className="px-4 py-3">purchase_date</th>
            <th className="px-4 py-3">payment_method</th>
            <th className="px-4 py-3">category</th>
            <th className="px-4 py-3">merchant</th>
            <th className="px-4 py-3">description</th>
            <th className="px-4 py-3 text-right">amount_mxn</th>
            <th className="px-4 py-3 text-center">is_msi</th>
            <th className="px-4 py-3 text-right">msi_months</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={`${item.id}-${item.created_at}`} className="border-t border-slate-100 align-top">
              <td className="whitespace-nowrap px-4 py-3">{item.purchase_date || "-"}</td>
              <td className="px-4 py-3">{item.payment_method || "-"}</td>
              <td className="px-4 py-3">{item.category || "-"}</td>
              <td className="px-4 py-3">{item.merchant || "-"}</td>
              <td className="max-w-[320px] px-4 py-3 text-slate-600">{item.description || "-"}</td>
              <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{formatCurrency(item.amount_mxn)}</td>
              <td className="px-4 py-3 text-center">{item.is_msi ? "Sí" : "No"}</td>
              <td className="px-4 py-3 text-right tabular-nums">{item.msi_months ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
