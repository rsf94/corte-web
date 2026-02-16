export function toISODate(date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function getDefaultExpensesDateRange(now = new Date()) {
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const from = new Date(to);
  from.setDate(from.getDate() - 30);

  return {
    from: toISODate(from),
    to: toISODate(to)
  };
}

export function buildExpensesQueryParams(filters, { cursor = "", limit = 50 } = {}) {
  const params = new URLSearchParams();

  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.payment_method) params.set("payment_method", filters.payment_method);
  if (filters.category) params.set("category", filters.category);
  if (filters.q) params.set("q", filters.q);
  if (filters.is_msi !== "all") params.set("is_msi", filters.is_msi);
  if (cursor) params.set("cursor", cursor);
  params.set("limit", String(limit));

  return params;
}
