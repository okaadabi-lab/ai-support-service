import type { HistoryTurn } from './types.js';

/**
 * Token counts are approximated as ceil(characters / 4). This avoids a tokenizer dependency;
 * Indonesian text tends to use somewhat more tokens per character than English, so keep the
 * budget conservative relative to the model's context window.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Keeps the most recent turns whose combined estimate fits the budget, in chronological order. */
export function trimHistory(turns: HistoryTurn[], tokenBudget: number): HistoryTurn[] {
  const kept: HistoryTurn[] = [];
  let used = 0;
  for (let index = turns.length - 1; index >= 0; index--) {
    const turn = turns[index];
    if (turn === undefined) {
      continue;
    }
    const cost = estimateTokens(turn.text);
    if (used + cost > tokenBudget) {
      break;
    }
    used += cost;
    kept.push(turn);
  }
  return kept.reverse();
}

export function renderTranscript(history: HistoryTurn[], latestMessage: string): string {
  const lines = history.map((turn) => `${turn.role}: ${turn.text}`);
  const historyBlock = lines.length > 0 ? lines.join('\n') : '(no earlier messages)';
  return [
    '<conversation_history>',
    historyBlock,
    '</conversation_history>',
    '<latest_customer_message>',
    latestMessage,
    '</latest_customer_message>',
  ].join('\n');
}
