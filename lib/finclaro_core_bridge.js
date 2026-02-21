import { parseExpenseText as parseExpenseTextLegacy } from "./expense_draft.js";

let finclaroCoreModulePromise;

function normalizeCurrency(value = "") {
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized) return "";
  if (!/^[A-Z]{3}$/.test(normalized)) return "";
  return normalized;
}

function pickFn(moduleNamespace, candidates = []) {
  for (const name of candidates) {
    const candidate = moduleNamespace?.[name];
    if (typeof candidate === "function") return candidate;
  }

  for (const exported of Object.values(moduleNamespace || {})) {
    if (!exported || typeof exported !== "object") continue;
    for (const name of candidates) {
      if (typeof exported[name] === "function") return exported[name];
    }
  }

  return null;
}

async function loadFinclaroCore() {
  if (!finclaroCoreModulePromise) {
    const dynamicImporter = new Function("specifier", "return import(specifier);");
    finclaroCoreModulePromise = dynamicImporter("finclaro-core").catch(() => null);
  }
  return finclaroCoreModulePromise;
}

function toDateInput(now) {
  if (now instanceof Date) return now.toISOString();
  return String(now || "");
}

function normalizeCoreDraftResult(result) {
  if (!result || typeof result !== "object") return null;

  if (result.error) {
    return { error: String(result.error || "") };
  }

  const source = result.parsed || result.draft || result.expense || result;
  if (!source || typeof source !== "object") return null;

  const rawText = String(source.raw_text ?? source.rawText ?? "").trim();
  const purchaseDate = String(source.purchase_date ?? source.purchaseDate ?? "").trim();
  const originalAmount = Number(source.original_amount ?? source.originalAmount ?? source.amount ?? NaN);
  const detectedCurrency = normalizeCurrency(source.detected_currency ?? source.detectedCurrency ?? source.currency ?? "");
  const description = String(source.description ?? "").trim();
  const merchant = String(source.merchant ?? "").trim();
  const category = String(source.category ?? "General").trim() || "General";
  const isMsi = Boolean(source.is_msi ?? source.isMsi ?? false);
  const msiRaw = source.msi_months ?? source.msiMonths ?? null;
  const parsedMsiMonths = msiRaw === null || msiRaw === undefined || msiRaw === ""
    ? null
    : Number.parseInt(String(msiRaw), 10);
  const msiMonths = Number.isFinite(parsedMsiMonths) && parsedMsiMonths > 0 ? parsedMsiMonths : null;

  if (!rawText || !purchaseDate || !Number.isFinite(originalAmount) || originalAmount <= 0) {
    return null;
  }

  return {
    error: "",
    parsed: {
      raw_text: rawText,
      purchase_date: purchaseDate,
      original_amount: originalAmount,
      detected_currency: detectedCurrency,
      description,
      merchant,
      category,
      is_msi: isMsi,
      msi_months: msiMonths
    }
  };
}

export async function parseExpenseTextWithCore(text, { now = new Date(), coreParser } = {}) {
  const parser = coreParser || await resolveCoreDraftParser();

  if (!parser) {
    return parseExpenseTextLegacy(text, { now });
  }

  try {
    const rawResult = await parser({
      text: String(text || ""),
      now: toDateInput(now),
      date: toDateInput(now)
    });

    const normalized = normalizeCoreDraftResult(rawResult);
    if (!normalized) return parseExpenseTextLegacy(text, { now });
    return normalized;
  } catch {
    return parseExpenseTextLegacy(text, { now });
  }
}

async function resolveCoreDraftParser() {
  const moduleNamespace = await loadFinclaroCore();
  if (!moduleNamespace) return null;

  return pickFn(moduleNamespace, [
    "parseExpenseText",
    "parseExpenseDraft",
    "parseExpenseInput",
    "parseExpenseFromText",
    "parseExpense"
  ]);
}

export async function normalizeExpensePayloadWithCore(payload, { normalizer } = {}) {
  const normalizeFn = normalizer || await resolveCorePayloadNormalizer();
  if (!normalizeFn) return null;

  try {
    const result = await normalizeFn(payload);
    if (!result || typeof result !== "object") return null;
    return result;
  } catch {
    return null;
  }
}

async function resolveCorePayloadNormalizer() {
  const moduleNamespace = await loadFinclaroCore();
  if (!moduleNamespace) return null;

  return pickFn(moduleNamespace, [
    "normalizeExpensePayload",
    "normalizeExpense",
    "validateAndNormalizeExpense",
    "validateExpensePayload"
  ]);
}
