export function getAnchorMonth(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export function addMonths(date, offset) {
  return new Date(date.getFullYear(), date.getMonth() + offset, 1);
}

export function monthStartISO(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1).toISOString().slice(0, 10);
}

export function getDefaultRange(now = new Date()) {
  const anchor = getAnchorMonth(now);
  return {
    from: monthStartISO(addMonths(anchor, -2)),
    to: monthStartISO(addMonths(anchor, 2))
  };
}

export function buildStackedChartData(data, fallbackMonths = []) {
  const months = data?.months ?? fallbackMonths;
  const rows = data?.rows ?? [];

  return months.map((month) => {
    const point = { month, total: data?.totals?.[month] ?? 0 };
    rows.forEach((row) => {
      point[row.card_name] = row.totals?.[month] ?? 0;
    });
    return point;
  });
}

export function getCardNames(data) {
  return (data?.rows ?? []).map((row) => row.card_name);
}
