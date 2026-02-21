import { getServerSession } from "next-auth";
import { getAuthOptions } from "../../../lib/auth.js";
import { getSessionWithE2EBypass } from "../../../lib/e2e_auth_bypass.js";
import { getAuthedUserContext } from "../../../lib/auth_user_context.js";
import { parseExpenseTextWithCore } from "../../../lib/finclaro_core_bridge.js";
import { convertToMxn } from "../../../lib/fx/frankfurter.js";

export const dynamic = "force-dynamic";

function normalizeCurrency(value = "") {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized || "MXN";
}


function sanitizeDetectedCurrency(value = "", text = "") {
  const normalized = normalizeCurrency(value);
  if (normalized === "MSI" && /\bmsi\b/i.test(String(text || ""))) return "";
  return normalized;
}

function detectMsiFromText(value = "") {
  const normalized = String(value || "").toLowerCase();
  if (!/\bmsi\b/.test(normalized)) return { isMsi: false, msiMonths: null };

  const monthsMatch = normalized.match(/(?:\ba\s*)?\b(\d{1,2})\s*msi\b/);
  if (!monthsMatch) return { isMsi: true, msiMonths: null };

  const parsed = Number.parseInt(monthsMatch[1], 10);
  return {
    isMsi: true,
    msiMonths: Number.isFinite(parsed) && parsed > 0 ? parsed : null
  };
}

async function fetchActiveTripForUser(userId, { queryFn }) {
  if (!userId || typeof queryFn !== "function") return null;

  const dataset = process.env.BQ_DATASET;
  const projectId = process.env.BQ_PROJECT_ID;
  if (!dataset || !projectId) return null;

  const tripsTable = `\`${projectId}.${dataset}.trips\``;
  const result = await queryFn({
    query: `
      SELECT id, base_currency
      FROM ${tripsTable}
      WHERE user_id = @user_id
        AND active = TRUE
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    params: { user_id: String(userId) }
  });
  const rows = Array.isArray(result?.[0]) ? result[0] : [];

  if (!rows.length) return null;
  return {
    id: String(rows[0].id || "").trim(),
    base_currency: normalizeCurrency(rows[0].base_currency || "")
  };
}

export async function handleExpenseDraftPost(
  request,
  {
    getSession = () => getSessionWithE2EBypass(() => getServerSession(getAuthOptions())),
    queryFn,
    fxConverter = convertToMxn,
    now = new Date(),
    parseDraft = parseExpenseTextWithCore
  } = {}
) {
  try {
    const authContext = await getAuthedUserContext(request, { getSession, queryFn });
    if (authContext.errorResponse) return authContext.errorResponse;

    const payload = await request.json();
    const text = String(payload?.text || "");
    const includeTrip = Boolean(payload?.include_trip ?? true);
    const activeTrip = includeTrip
      ? await fetchActiveTripForUser(authContext.user_id, { queryFn })
      : null;
    const requestedTripId = includeTrip ? String(payload?.trip_id || "").trim() : "";
    const tripId = includeTrip
      ? (requestedTripId && requestedTripId === activeTrip?.id ? requestedTripId : activeTrip?.id || "")
      : "";
    const tripCurrency = includeTrip
      ? normalizeCurrency(payload?.trip_base_currency || activeTrip?.base_currency || "")
      : "";

    const parsed = await parseDraft(text, { now });
    if (parsed.error) {
      return Response.json({ error: parsed.error }, { status: 400 });
    }

    const detectedCurrency = sanitizeDetectedCurrency(parsed.parsed.detected_currency, text);
    const originalCurrency = normalizeCurrency(detectedCurrency || tripCurrency || "MXN");
    const originalAmount = Number(parsed.parsed.original_amount);

    let amountMxn = originalAmount;
    let amountMxnSource = "direct";
    let fxRate = null;
    let fxProvider = null;
    let fxDate = null;

    if (originalCurrency !== "MXN") {
      const conversion = await fxConverter({
        amount: originalAmount,
        baseCurrency: originalCurrency,
        quoteCurrency: "MXN",
        date: parsed.parsed.purchase_date
      });
      amountMxn = Number((originalAmount * conversion.rate).toFixed(2));
      amountMxnSource = "fx";
      fxRate = conversion.rate;
      fxProvider = conversion.provider;
      fxDate = conversion.date;
    }

    const msiFromText = detectMsiFromText(text);
    const draftIsMsi = parsed.parsed.is_msi || msiFromText.isMsi;
    const draftMsiMonths = parsed.parsed.msi_months ?? msiFromText.msiMonths;

    const draft = {
      purchase_date: parsed.parsed.purchase_date,
      original_amount: originalAmount,
      original_currency: originalCurrency,
      amount_mxn: amountMxn,
      amount_mxn_source: amountMxnSource,
      fx_rate: fxRate,
      fx_provider: fxProvider,
      fx_date: fxDate,
      description: parsed.parsed.description,
      merchant: parsed.parsed.merchant,
      category: parsed.parsed.category,
      raw_text: parsed.parsed.raw_text,
      is_msi: draftIsMsi,
      msi_months: draftMsiMonths,
      trip_id: tripId || null
    };

    return Response.json({
      ok: true,
      draft,
      suggestions: { payment_methods: [] },
      ui: { message: "Listo. Elige método de pago para confirmar." }
    });
  } catch (error) {
    return Response.json({ error: error.message || "Server error" }, { status: 500 });
  }
}

export async function POST(request) {
  return handleExpenseDraftPost(request);
}
