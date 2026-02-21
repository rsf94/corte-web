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

function queryErrorToString(error) {
  return String(error?.message || "unknown_error");
}

async function runQueryWithDiagnostics({ queryFn, query, params, diagnostics, key }) {
  try {
    const [rows] = await queryFn({ query, params });
    diagnostics[key] = { status: "ok", error: "" };
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    diagnostics[key] = { status: "error", error: queryErrorToString(error) };
    return [];
  }
}

function extractMethodLabels(rows = []) {
  const methods = [];
  for (const row of rows) {
    const rawValue = row?.account_name ?? row?.card_name ?? "";
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

async function fetchAccountsMethods(owner, { queryFn, accountsTable, diagnostics, diagnosticsKey }) {
  if (!owner?.value) return [];
  const ownerField = owner.key === "user_id" ? "user_id" : "chat_id";
  const source = owner.key === "user_id" ? "accounts_user" : "accounts_chat";

  const rows = await runQueryWithDiagnostics({
    queryFn,
    diagnostics,
    key: diagnosticsKey,
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

  return extractMethodLabels(rows).map((label) => toMethodShape(label, source));
}

async function fetchCardRuleMethods(owner, { queryFn, cardRulesTable, diagnostics, diagnosticsKey }) {
  if (!owner?.value) return [];
  const ownerField = owner.key === "user_id" ? "user_id" : "chat_id";
  const source = owner.key === "user_id" ? "card_rules_user" : "card_rules_chat";

  const rows = await runQueryWithDiagnostics({
    queryFn,
    diagnostics,
    key: diagnosticsKey,
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

  return extractMethodLabels(rows).map((label) => toMethodShape(label, source));
}

export async function fetchExpenseCaptureContext({ userId, chatId }, { queryFn }) {
  const dataset = requiredEnv("BQ_DATASET");
  const projectId = requiredEnv("BQ_PROJECT_ID");
  const tripsTable = `\`${projectId}.${dataset}.trips\``;
  const cardRulesTable = `\`${projectId}.${dataset}.card_rules\``;
  const accountsTable = `\`${projectId}.${dataset}.accounts\``;

  const activeTrip = await fetchActiveTripByUserId(userId, { queryFn, tripsTable });

  const diagnostics = {
    bq_dataset: dataset,
    methods_count_accounts_user: 0,
    methods_count_accounts_chat: 0,
    methods_count_card_rules_user: 0,
    methods_count_card_rules_chat: 0,
    final_methods_count: 0,
    query_status: {
      accounts_user: { status: "skipped", error: "" },
      accounts_chat: { status: "skipped", error: "" },
      card_rules_user: { status: "skipped", error: "" },
      card_rules_chat: { status: "skipped", error: "" }
    }
  };

  const ownerUser = userId ? { key: "user_id", value: String(userId) } : null;
  const ownerChat = chatId ? { key: "chat_id", value: String(chatId) } : null;

  const accountsUser = await fetchAccountsMethods(ownerUser, {
    queryFn,
    accountsTable,
    diagnostics: diagnostics.query_status,
    diagnosticsKey: "accounts_user"
  });
  const accountsChat = await fetchAccountsMethods(ownerChat, {
    queryFn,
    accountsTable,
    diagnostics: diagnostics.query_status,
    diagnosticsKey: "accounts_chat"
  });

  const cardRulesUser = await fetchCardRuleMethods(ownerUser, {
    queryFn,
    cardRulesTable,
    diagnostics: diagnostics.query_status,
    diagnosticsKey: "card_rules_user"
  });
  const cardRulesChat = await fetchCardRuleMethods(ownerChat, {
    queryFn,
    cardRulesTable,
    diagnostics: diagnostics.query_status,
    diagnosticsKey: "card_rules_chat"
  });

  diagnostics.methods_count_accounts_user = accountsUser.length;
  diagnostics.methods_count_accounts_chat = accountsChat.length;
  diagnostics.methods_count_card_rules_user = cardRulesUser.length;
  diagnostics.methods_count_card_rules_chat = cardRulesChat.length;

  const methods = mergeMethods([accountsUser, accountsChat, cardRulesUser, cardRulesChat]);
  diagnostics.final_methods_count = methods.length;

  return {
    methods,
    hasTrip: Boolean(activeTrip?.id),
    activeTripId: activeTrip?.id ?? null,
    active_trip: activeTrip,
    defaults: {
      includeTripByDefault: Boolean(activeTrip?.id),
      source_counts: {
        user: accountsUser.length + cardRulesUser.length,
        chat: accountsChat.length + cardRulesChat.length,
        merged: methods.length
      }
    },
    diagnostics
  };
}

export async function fetchExpenseCaptureContextByUserId(userId, { queryFn }) {
  return fetchExpenseCaptureContext({ userId, chatId: "" }, { queryFn });
}
