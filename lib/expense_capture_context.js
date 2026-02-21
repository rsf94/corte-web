function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env ${name}`);
  return value;
}

function normalizeCurrency(value = "") {
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized) return "";
  return normalized;
}

function normalizePaymentMethods(rows = []) {
  const seen = new Set();
  const normalized = [];

  for (const row of rows) {
    const rawValue = row?.card_name ?? row?.payment_method ?? row?.paymentMethod ?? row?.account_name ?? row?.method ?? row?.name ?? "";
    const value = String(rawValue).trim();
    if (!value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }

  return normalized;
}

async function fetchActiveTripByUserId(userId, { queryFn, tripsTable }) {
  if (!userId) return null;

  const [tripRows] = await queryFn({
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

  return tripRows[0]
    ? {
      id: String(tripRows[0].id),
      base_currency: normalizeCurrency(tripRows[0].base_currency)
    }
    : null;
}

async function fetchPaymentMethodsByOwner({ userId, chatId }, { queryFn, cardRulesTable, expensesTable }) {
  const ownerParam = userId ? { key: "user_id", value: String(userId) } : { key: "chat_id", value: String(chatId) };
  if (!ownerParam.value) return [];

  const [ruleRows] = await queryFn({
    query: `
      SELECT DISTINCT card_name
      FROM ${cardRulesTable}
      WHERE ${ownerParam.key} = @owner_id
        AND active = TRUE
        AND card_name IS NOT NULL
        AND TRIM(card_name) != ""
      ORDER BY card_name
    `,
    params: { owner_id: ownerParam.value }
  });

  let paymentMethods = normalizePaymentMethods(ruleRows);
  if (paymentMethods.length) return paymentMethods;

  const ownerFilters = ownerParam.key === "chat_id"
    ? "chat_id = @owner_id AND user_id IS NULL"
    : "user_id = @owner_id";

  const [expenseRows] = await queryFn({
    query: `
      SELECT DISTINCT payment_method
      FROM ${expensesTable}
      WHERE ${ownerFilters}
        AND payment_method IS NOT NULL
        AND TRIM(payment_method) != ""
      ORDER BY payment_method
      LIMIT 20
    `,
    params: { owner_id: ownerParam.value }
  });

  paymentMethods = normalizePaymentMethods(expenseRows);
  return paymentMethods;
}

export async function fetchExpenseCaptureContext({ userId, chatId }, { queryFn }) {
  const dataset = requiredEnv("BQ_DATASET");
  const projectId = requiredEnv("BQ_PROJECT_ID");
  const tripsTable = `\`${projectId}.${dataset}.trips\``;
  const cardRulesTable = `\`${projectId}.${dataset}.card_rules\``;
  const expensesTable = `\`${projectId}.${dataset}.expenses\``;

  const activeTrip = await fetchActiveTripByUserId(userId, { queryFn, tripsTable });
  let paymentMethods = await fetchPaymentMethodsByOwner({ userId }, { queryFn, cardRulesTable, expensesTable });

  if (!paymentMethods.length && chatId) {
    paymentMethods = await fetchPaymentMethodsByOwner({ chatId }, { queryFn, cardRulesTable, expensesTable });
  }

  return {
    active_trip: activeTrip,
    suggestions: {
      payment_methods: paymentMethods
    }
  };
}

export async function fetchExpenseCaptureContextByUserId(userId, { queryFn }) {
  return fetchExpenseCaptureContext({ userId, chatId: "" }, { queryFn });
}
