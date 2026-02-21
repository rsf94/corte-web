import { getServerSession } from "next-auth";
import { getAuthOptions } from "../../../lib/auth.js";
import { getAuthedUserContext } from "../../../lib/auth_user_context.js";
import { parseExpenseTextWithCore } from "../../../lib/finclaro_core_bridge.js";
import { convertToMxn } from "../../../lib/fx/frankfurter.js";

export const dynamic = "force-dynamic";

function normalizeCurrency(value = "") {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized || "MXN";
}

export async function handleExpenseDraftPost(
  request,
  {
    getSession = () => getServerSession(getAuthOptions()),
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
    const tripId = includeTrip ? String(payload?.trip_id || "").trim() : "";
    const tripCurrency = includeTrip ? normalizeCurrency(payload?.trip_base_currency || "") : "";

    const parsed = await parseDraft(text, { now });
    if (parsed.error) {
      return Response.json({ error: parsed.error }, { status: 400 });
    }

    const detectedCurrency = parsed.parsed.detected_currency;
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
      is_msi: parsed.parsed.is_msi,
      msi_months: parsed.parsed.msi_months,
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
