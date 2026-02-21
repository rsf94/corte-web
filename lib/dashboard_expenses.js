const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DMY_DATE_PATTERN = /^(\d{2})\/(\d{2})\/(\d{4})$/;

export function normalizeDateForApi(value = "") {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  if (ISO_DATE_PATTERN.test(normalized)) return normalized;

  const dmyMatch = normalized.match(DMY_DATE_PATTERN);
  if (!dmyMatch) return "";

  const [, day, month, year] = dmyMatch;
  return `${year}-${month}-${day}`;
}

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
  const from = normalizeDateForApi(filters.from);
  const to = normalizeDateForApi(filters.to);

  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (filters.payment_method) params.set("payment_method", filters.payment_method);
  if (filters.category) params.set("category", filters.category);
  if (filters.q) params.set("q", filters.q);
  if (filters.is_msi !== "all") params.set("is_msi", filters.is_msi);
  if (cursor) params.set("cursor", cursor);
  params.set("limit", String(limit));

  return params;
}
