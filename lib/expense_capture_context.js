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

export async function fetchExpenseCaptureContextByUserId(userId, { queryFn }) {
  const dataset = requiredEnv("BQ_DATASET");
  const projectId = requiredEnv("BQ_PROJECT_ID");
  const tripsTable = `\`${projectId}.${dataset}.trips\``;
  const cardRulesTable = `\`${projectId}.${dataset}.card_rules\``;
  const expensesTable = `\`${projectId}.${dataset}.expenses\``;

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

  const activeTrip = tripRows[0]
    ? {
      id: String(tripRows[0].id),
      base_currency: normalizeCurrency(tripRows[0].base_currency)
    }
    : null;

  const [ruleRows] = await queryFn({
    query: `
      SELECT DISTINCT card_name
      FROM ${cardRulesTable}
      WHERE user_id = @user_id
        AND active = TRUE
        AND card_name IS NOT NULL
        AND TRIM(card_name) != ""
      ORDER BY card_name
    `,
    params: { user_id: String(userId) }
  });

  let paymentMethods = ruleRows.map((row) => String(row.card_name).trim()).filter(Boolean);

  if (!paymentMethods.length) {
    const [expenseRows] = await queryFn({
      query: `
        SELECT DISTINCT payment_method
        FROM ${expensesTable}
        WHERE user_id = @user_id
          AND payment_method IS NOT NULL
          AND TRIM(payment_method) != ""
        ORDER BY payment_method
        LIMIT 20
      `,
      params: { user_id: String(userId) }
    });

    paymentMethods = expenseRows.map((row) => String(row.payment_method).trim()).filter(Boolean);
  }

  return {
    active_trip: activeTrip,
    suggestions: {
      payment_methods: paymentMethods
    }
  };
}
