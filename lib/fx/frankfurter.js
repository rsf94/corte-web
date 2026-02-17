const DEFAULT_PROVIDER = "frankfurter";

export async function convertToMxn({ amount, baseCurrency, quoteCurrency = "MXN", date }) {
  const normalizedBase = String(baseCurrency || "").trim().toUpperCase();
  const normalizedQuote = String(quoteCurrency || "MXN").trim().toUpperCase();
  const normalizedDate = String(date || "").trim();

  if (!normalizedBase || !/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) {
    throw new Error("FX params inválidos");
  }

  const url = `https://api.frankfurter.app/${normalizedDate}?from=${encodeURIComponent(normalizedBase)}&to=${encodeURIComponent(normalizedQuote)}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`FX unavailable (${response.status})`);
  }

  const payload = await response.json();
  const rate = Number(payload?.rates?.[normalizedQuote]);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error("FX rate inválido");
  }

  return {
    amount,
    rate,
    provider: DEFAULT_PROVIDER,
    date: payload?.date ?? normalizedDate
  };
}
