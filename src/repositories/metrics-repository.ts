import type { Db } from '../db/database.js';

export interface MetricsWindow {
  from: string;
  to: string;
}

export interface Metrics {
  window: MetricsWindow;
  total_decisions: number;
  actions: { reply: number; escalate: number; none: number };
  escalation_rate: number | null;
  escalation_reasons: Record<string, number>;
  intents: Record<string, number>;
  classifier_fallback_count: number;
  latency_ms: { p50: number | null; p95: number | null };
  tokens: { input: number; output: number };
  estimated_cost_usd: number;
}

export class MetricsRepository {
  constructor(private readonly db: Db) {}

  /** Window is half-open: from <= created_at < to (ISO-8601 UTC strings compare lexically). */
  aggregate(window: MetricsWindow): Metrics {
    const params = { from: window.from, to: window.to };
    const inWindow = 'created_at >= @from AND created_at < @to';

    const actionRows = this.db
      .prepare(`SELECT action, COUNT(*) AS n FROM decisions WHERE ${inWindow} GROUP BY action`)
      .all(params) as { action: 'reply' | 'escalate' | 'none'; n: number }[];
    const actions = { reply: 0, escalate: 0, none: 0 };
    for (const row of actionRows) {
      actions[row.action] = row.n;
    }

    const intentRows = this.db
      .prepare(
        `SELECT intent, COUNT(*) AS n FROM decisions
         WHERE ${inWindow} AND intent IS NOT NULL GROUP BY intent ORDER BY n DESC, intent`,
      )
      .all(params) as { intent: string; n: number }[];

    const reasonRows = this.db
      .prepare(
        `SELECT reason.value AS reason, COUNT(*) AS n
         FROM decisions, json_each(decisions.reasons) AS reason
         WHERE ${inWindow} AND decisions.action = 'escalate'
         GROUP BY reason.value ORDER BY n DESC, reason.value`,
      )
      .all(params) as { reason: string; n: number }[];

    const totals = this.db
      .prepare(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(input_tokens), 0) AS input_tokens,
                COALESCE(SUM(output_tokens), 0) AS output_tokens,
                COALESCE(SUM(estimated_cost_usd), 0) AS cost,
                COALESCE(SUM(classifier_source = 'fallback'), 0) AS fallbacks
         FROM decisions WHERE ${inWindow}`,
      )
      .get(params) as {
      total: number;
      input_tokens: number;
      output_tokens: number;
      cost: number;
      fallbacks: number;
    };

    const latencies = (
      this.db
        .prepare(`SELECT latency_ms FROM decisions WHERE ${inWindow} ORDER BY latency_ms`)
        .all(params) as { latency_ms: number }[]
    ).map((row) => row.latency_ms);

    // Silent decisions (human already handling the chat) are not bot outcomes, so they are
    // excluded from the escalation rate denominator.
    const botDecisions = actions.reply + actions.escalate;
    return {
      window,
      total_decisions: totals.total,
      actions,
      escalation_rate: botDecisions > 0 ? round(actions.escalate / botDecisions, 4) : null,
      escalation_reasons: Object.fromEntries(reasonRows.map((row) => [row.reason, row.n])),
      intents: Object.fromEntries(intentRows.map((row) => [row.intent, row.n])),
      classifier_fallback_count: totals.fallbacks,
      latency_ms: { p50: percentile(latencies, 50), p95: percentile(latencies, 95) },
      tokens: { input: totals.input_tokens, output: totals.output_tokens },
      estimated_cost_usd: round(totals.cost, 6),
    };
  }
}

/** Nearest-rank percentile on an ascending list. */
export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) {
    return null;
  }
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] ?? null;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
