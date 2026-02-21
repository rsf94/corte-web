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

function normalizeLabel(value = "") {
  return String(value || "").trim();
}

function normalizeMethodKey(value = "") {
  return normalizeLabel(value).toLowerCase();
}

function toMethodShape(label, source) {
  const normalizedLabel = normalizeMethodKey(label);
  return {
    id: normalizedLabel,
    label: normalizeLabel(label),
    source,
    normalizedLabel
  };
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

async function runQuerySafe(queryFn, options) {
  try {
    return await queryFn(options);
  } catch (error) {
    const message = String(error?.message || "");
    if (/Unrecognized name|not found|No such field/i.test(message)) {
      return [[]];
    }
    throw error;
  }
}

function extractMethodLabels(rows = []) {
  const methods = [];
  for (const row of rows) {
    const rawValue = row?.card_name ?? row?.payment_method ?? row?.paymentMethod ?? row?.account_name ?? row?.method ?? row?.name ?? "";
    const label = normalizeLabel(rawValue);
    if (!label) continue;
    methods.push(label);
  }
  return methods;
}

function mergeMethods(methodLists = []) {
  const merged = [];
  const seen = new Set();

  for (const methods of methodLists) {
    for (const method of methods) {
      const key = normalizeMethodKey(method.label);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(method);
    }
  }

  return merged;
}

async function fetchMethodsForOwner(owner, { queryFn, cardRulesTable, expensesTable, accountsTable }) {
  if (!owner?.value) return [];

  const ownerField = owner.key === "user_id" ? "user_id" : "chat_id";
  const source = owner.key === "user_id" ? "user" : "chat";

  const [ruleRows] = await runQuerySafe(queryFn, {
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

  const [expenseRows] = await runQuerySafe(queryFn, {
    query: `
      SELECT DISTINCT payment_method
      FROM ${expensesTable}
      WHERE ${ownerField} = @owner_id
        AND payment_method IS NOT NULL
        AND TRIM(payment_method) != ""
      ORDER BY payment_method
      LIMIT 20
    `,
    params: { owner_id: String(owner.value) }
  });

  const [accountRows] = await runQuerySafe(queryFn, {
    query: `
      SELECT DISTINCT account_name
      FROM ${accountsTable}
      WHERE ${ownerField} = @owner_id
        AND active = TRUE
        AND account_name IS NOT NULL
        AND TRIM(account_name) != ""
      ORDER BY account_name
    `,
    params: { owner_id: String(owner.value) }
  });

  const labels = extractMethodLabels([...ruleRows, ...expenseRows, ...accountRows]);
  return labels.map((label) => toMethodShape(label, source));
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
  const methodsByOwner = [];
  const counts = {
    user: 0,
    chat: 0
  };
  for (const owner of owners) {
    const methods = await fetchMethodsForOwner(owner, {
      queryFn,
      cardRulesTable,
      expensesTable,
      accountsTable
    });
    methodsByOwner.push(methods);
    if (owner.key === "user_id") counts.user = methods.length;
    if (owner.key === "chat_id") counts.chat = methods.length;
  }

  const methods = mergeMethods(methodsByOwner);

  return {
    methods,
    hasTrip: Boolean(activeTrip?.id),
    activeTripId: activeTrip?.id ?? null,
    active_trip: activeTrip,
    defaults: {
      includeTripByDefault: Boolean(activeTrip?.id),
      source_counts: {
        user: counts.user,
        chat: counts.chat,
        merged: methods.length
      }
    },
    diagnostics: {
      methods_user_id: counts.user,
      methods_chat_id: counts.chat,
      methods_merged: methods.length
    }
  };
}

export async function fetchExpenseCaptureContextByUserId(userId, { queryFn }) {
  return fetchExpenseCaptureContext({ userId, chatId: "" }, { queryFn });
}
