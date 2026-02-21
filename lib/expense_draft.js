function toIsoDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function normalizeCurrency(value = "") {
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized) return "";
  if (!/^[A-Z]{3}$/.test(normalized)) return "";
  return normalized;
}

function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function parseExpenseText(text, { now = new Date() } = {}) {
  const rawText = cleanText(text);
  if (!rawText) return { error: "Escribe un gasto para continuar." };

  let remaining = rawText;
  let purchaseDate = toIsoDate(now);

  const dateMatch = remaining.match(/^(\d{4}-\d{2}-\d{2})\s+/);
  if (dateMatch) {
    purchaseDate = dateMatch[1];
    remaining = remaining.slice(dateMatch[0].length).trim();
  }

  const amountMatch = remaining.match(/^(\d+(?:\.\d{1,2})?)\s*/);
  if (!amountMatch) {
    return { error: "No pude identificar el monto. Ejemplo: 230 uber" };
  }

  const amount = Number.parseFloat(amountMatch[1]);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "El monto debe ser mayor a cero." };
  }

  remaining = remaining.slice(amountMatch[0].length).trim();

  let detectedCurrency = "";
  const currencyMatch = remaining.match(/^([A-Za-z]{3})\b\s*/);
  if (currencyMatch) {
    detectedCurrency = normalizeCurrency(currencyMatch[1]);
    remaining = remaining.slice(currencyMatch[0].length).trim();
  }

  let isMsi = false;
  let msiMonths = null;
  const msiMatch = remaining.match(/(?:\ba\s*)?\b(\d{1,2})\s*MSI\b/i);
  if (msiMatch) {
    const parsed = Number.parseInt(msiMatch[1], 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      isMsi = true;
      msiMonths = parsed;
      remaining = cleanText(remaining.replace(msiMatch[0], ""));
    }
  }

  const description = remaining;
  const merchant = description ? description.split(" ")[0] : "";

  return {
    error: "",
    parsed: {
      raw_text: rawText,
      purchase_date: purchaseDate,
      original_amount: amount,
      detected_currency: detectedCurrency,
      description,
      merchant,
      category: "General",
      is_msi: isMsi,
      msi_months: msiMonths
    }
  };
}
