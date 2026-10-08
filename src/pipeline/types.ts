export const INTENTS = [
  'pricing_question',
  'availability_question',
  'booking_change',
  'complaint',
  'refund_request',
  'human_request',
  'greeting',
  'other',
] as const;

export type Intent = (typeof INTENTS)[number];

export const LANGUAGES = ['id', 'en'] as const;

export type Language = (typeof LANGUAGES)[number];

export type Action = 'reply' | 'escalate' | 'none';

export type ClassifierSource = 'llm' | 'fallback' | 'skipped';

/** Machine-readable codes stored with every decision and aggregated by /v1/metrics. */
export const REASONS = [
  'answered_from_knowledge_base',
  'greeting_template',
  'human_handoff_active',
  'intent_complaint',
  'intent_refund_request',
  'intent_human_request',
  'low_classifier_confidence',
  'classifier_llm_failed',
  'no_relevant_articles',
  'answer_llm_failed',
  'low_answer_confidence',
  'validation_schema',
  'validation_no_citations',
  'validation_citation_not_retrieved',
  'validation_unsupported_amount',
  'validation_forbidden_promise',
  'validation_reply_too_short',
  'validation_reply_too_long',
] as const;

export type Reason = (typeof REASONS)[number];

export interface HistoryTurn {
  role: 'customer' | 'assistant';
  text: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export const ZERO_USAGE: Usage = { inputTokens: 0, outputTokens: 0 };

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  };
}
