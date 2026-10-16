const json = value => JSON.stringify(value);
const parse = value => JSON.parse(value);
const isSuitableFeedback = feedback => feedback === 'suitable' || feedback === '\u9002\u5408\u6211';

function localDateParts(now) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
}

export function previousWeek(now = new Date()) {
  const { year, month, day } = localDateParts(now);
  const today = new Date(Date.UTC(year, month - 1, day));
  const weekday = (today.getUTCDay() + 6) % 7;
  today.setUTCDate(today.getUTCDate() - weekday);
  const end = new Date(today.getTime() - 8 * 3600_000);
  const start = new Date(end.getTime() - 7 * 24 * 3600_000);
  const previousMonday = new Date(today.getTime() - 7 * 24 * 3600_000);
  return { week: previousMonday.toISOString().slice(0, 10), start: start.toISOString(), end: end.toISOString() };
}

export function generateWeeklyReport(db, now = new Date()) {
  const { week, start, end } = previousWeek(now);
  const existing = db.prepare('SELECT report_json FROM reports WHERE week=?').get(week);
  if (existing) return parse(existing.report_json);
  const rows = db.prepare(`SELECT r.mode,r.feedback,r.score,r.profile_json,p.tags_json,p.price_usd
    FROM recommendations r JOIN products p ON p.id=r.product_id
    WHERE r.created_at >= ? AND r.created_at < ? AND r.feedback IS NOT NULL`).all(start, end);
  const total = rows.length;
  const correct = rows.filter(row => (row.mode === 'best') === isSuitableFeedback(row.feedback)).length;
  const byType = new Map();
  const byMode = { best: { count: 0, correct: 0 }, worst: { count: 0, correct: 0 } };
  let budgetMismatch = 0, preferenceMismatch = 0;
  for (const row of rows) {
    const tags = parse(row.tags_json), profile = parse(row.profile_json);
    const hit = (row.mode === 'best') === isSuitableFeedback(row.feedback);
    const type = tags.product_type || 'Uncategorized';
    if (!byType.has(type)) byType.set(type, { count: 0, correct: 0 });
    byType.get(type).count++;
    byType.get(type).correct += Number(hit);
    byMode[row.mode].count++;
    byMode[row.mode].correct += Number(hit);
    if (!hit && profile.budget_exceeded === true) budgetMismatch++;
    if (!hit && profile.has_preferences === true) preferenceMismatch++;
  }
  const suggestions = [];
  if (total < 20) suggestions.push('Fewer than 20 feedback samples are available. Treat accuracy as preliminary and collect more feedback before adjusting ranking weights.');
  if (total && correct / total < 0.7) suggestions.push('Recommendation accuracy is below 70%. Manually review mismatched products and their type, location, and audience tags.');
  if (budgetMismatch) suggestions.push(`${budgetMismatch} incorrect recommendations exceeded the user's stated budget. Consider increasing the budget filter weight.`);
  if (preferenceMismatch) suggestions.push(`${preferenceMismatch} incorrect recommendations involved stated likes or dislikes. Improve how product keywords match user preferences.`);
  if (!total) suggestions.push('No recommendation feedback was received this week, so accuracy cannot be assessed.');
  const report = {
    week_start: week, timezone: 'Asia/Shanghai', interval_utc: { start, end },
    feedback_count: total, correct_count: correct,
    accuracy: total ? Number((correct / total).toFixed(4)) : null,
    by_mode: byMode,
    by_product_type: Object.fromEntries([...byType.entries()].sort((a, b) => b[1].count - a[1].count)),
    mismatch_signals: { budget: budgetMismatch, preference: preferenceMismatch },
    recommendations: suggestions,
    method: 'A best recommendation with suitable feedback or a worst recommendation with unsuitable feedback counts as correct. Only results with feedback are included. Ethnicity is not used in recommendation ranking.'
  };
  db.prepare('INSERT INTO reports VALUES (?,?,?)').run(week, new Date().toISOString(), json(report));
  return report;
}

export function latestReport(db) {
  const row = db.prepare('SELECT report_json FROM reports ORDER BY week DESC LIMIT 1').get();
  return row ? parse(row.report_json) : null;
}

export function reportForWeek(db, week) {
  const row = db.prepare('SELECT report_json FROM reports WHERE week=?').get(week);
  return row ? parse(row.report_json) : null;
}
