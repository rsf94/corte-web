export default function ExpensesFilters({
  draft,
  paymentMethods,
  categories,
  onDraftChange,
  onApply,
  isLoading
}) {
  return (
    <form
      className="grid grid-cols-1 gap-4 rounded border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-2 xl:grid-cols-6"
      onSubmit={(event) => {
        event.preventDefault();
        onApply();
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        Desde
        <input
          className="rounded border border-slate-300 px-3 py-2"
          type="date"
          value={draft.from}
          onChange={(event) => onDraftChange("from", event.target.value)}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Hasta
        <input
          className="rounded border border-slate-300 px-3 py-2"
          type="date"
          value={draft.to}
          onChange={(event) => onDraftChange("to", event.target.value)}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Tarjeta
        <select
          className="rounded border border-slate-300 px-3 py-2"
          value={draft.payment_method}
          onChange={(event) => onDraftChange("payment_method", event.target.value)}
        >
          <option value="">Todas</option>
          {paymentMethods.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Categoría
        <select
          className="rounded border border-slate-300 px-3 py-2"
          value={draft.category}
          onChange={(event) => onDraftChange("category", event.target.value)}
        >
          <option value="">Todas</option>
          {categories.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        MSI
        <select
          className="rounded border border-slate-300 px-3 py-2"
          value={draft.is_msi}
          onChange={(event) => onDraftChange("is_msi", event.target.value)}
        >
          <option value="all">Todos</option>
          <option value="true">Solo MSI</option>
          <option value="false">Solo no MSI</option>
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm xl:col-span-2">
        Buscar
        <input
          className="rounded border border-slate-300 px-3 py-2"
          type="search"
          placeholder="comercio, descripción o texto original"
          value={draft.q}
          onChange={(event) => onDraftChange("q", event.target.value)}
        />
      </label>

      <div className="md:col-span-2 xl:col-span-6">
        <button
          className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          type="submit"
          disabled={isLoading}
        >
          Aplicar filtros
        </button>
      </div>
    </form>
  );
}
