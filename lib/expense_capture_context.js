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

    const dedupeKey = value.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
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

async function fetchMethodsForOwner(owner, { queryFn, cardRulesTable, expensesTable, accountsTable }) {
  if (!owner?.value) return [];

  const ownerField = owner.key === "user_id" ? "user_id" : "chat_id";

  const [ruleRows] = await queryFn({
    query: `
      SELECT DISTINCT card_name
      FROM ${cardRulesTable}
      WHERE ${ownerField} = @owner_id
        AND active = TRUE
        AND card_name IS NOT NULL
        AND TRIM(card_name) != ""
      ORDER BY card_name
    `,
    params: { owner_id: String(owner.value) }
  });

  const [expenseRows] = await queryFn({
    query: `
      SELECT DISTINCT payment_method
      FROM ${expensesTable}
      WHERE ${ownerField} = @owner_id
        ${ownerField === "chat_id" ? "AND user_id IS NULL" : ""}
        AND payment_method IS NOT NULL
        AND TRIM(payment_method) != ""
      ORDER BY payment_method
      LIMIT 20
    `,
    params: { owner_id: String(owner.value) }
  });

  const accountRows = ownerField === "chat_id"
    ? (await queryFn({
      query: `
        SELECT DISTINCT account_name
        FROM ${accountsTable}
        WHERE chat_id = @owner_id
          AND active = TRUE
          AND account_name IS NOT NULL
          AND TRIM(account_name) != ""
        ORDER BY account_name
      `,
      params: { owner_id: String(owner.value) }
    }))[0]
    : [];

  return normalizePaymentMethods([...ruleRows, ...expenseRows, ...accountRows]);
}

function buildOwners({ userId, chatId }) {
  const owners = [];
  if (userId) owners.push({ key: "user_id", value: String(userId) });
  if (chatId) owners.push({ key: "chat_id", value: String(chatId) });
  return owners;
}

export async function fetchExpenseCaptureContext({ userId, chatId }, { queryFn }) {
  const dataset = requiredEnv("BQ_DATASET");
  const projectId = requiredEnv("BQ_PROJECT_ID");
  const tripsTable = `\`${projectId}.${dataset}.trips\``;
  const cardRulesTable = `\`${projectId}.${dataset}.card_rules\``;
  const expensesTable = `\`${projectId}.${dataset}.expenses\``;
  const accountsTable = `\`${projectId}.${dataset}.accounts\``;

  const activeTrip = await fetchActiveTripByUserId(userId, { queryFn, tripsTable });

  const owners = buildOwners({ userId, chatId });
  const mergedMethods = [];
  for (const owner of owners) {
    const methods = await fetchMethodsForOwner(owner, {
      queryFn,
      cardRulesTable,
      expensesTable,
      accountsTable
    });
    mergedMethods.push(...methods);
  }

  const paymentMethods = normalizePaymentMethods(mergedMethods.map((method) => ({ name: method })));

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
