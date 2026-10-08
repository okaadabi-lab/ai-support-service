import type { RetrievedArticle } from '../retrieval/retriever.js';
import type { Classification } from './classifier.js';
import type { ResponderResult } from './responder.js';
import type { Action, Intent, Reason } from './types.js';
import type { ValidationResult } from './validator.js';

export interface Verdict {
  action: Action;
  reasons: Reason[];
}

export interface PolicyOptions {
  minClassifierConfidence: number;
  minAnswerConfidence: number;
}

const ALWAYS_ESCALATE: Partial<Record<Intent, Reason>> = {
  complaint: 'intent_complaint',
  refund_request: 'intent_refund_request',
  human_request: 'intent_human_request',
};

/**
 * Every check returns either a final verdict or null ("no objection, continue"). The pipeline
 * consults the policy after each stage so that it never spends an LLM call on a message that
 * is already going to a human. Checks collect all applicable reasons, not just the first,
 * so metrics show why a decision was made in full.
 */
export class EscalationPolicy {
  constructor(private readonly options: PolicyOptions) {}

  checkConversation(status: 'bot' | 'human'): Verdict | null {
    return status === 'human' ? { action: 'none', reasons: ['human_handoff_active'] } : null;
  }

  checkClassification(classification: Classification): Verdict | null {
    const reasons: Reason[] = [];
    const intentReason = ALWAYS_ESCALATE[classification.intent];
    if (intentReason) {
      reasons.push(intentReason);
    }
    if (classification.source === 'fallback') {
      reasons.push('classifier_llm_failed');
    } else if (classification.confidence < this.options.minClassifierConfidence) {
      reasons.push('low_classifier_confidence');
    }
    if (reasons.length > 0) {
      return { action: 'escalate', reasons };
    }
    if (classification.intent === 'greeting') {
      return { action: 'reply', reasons: ['greeting_template'] };
    }
    return null;
  }

  checkRetrieval(retrieved: RetrievedArticle[]): Verdict | null {
    return retrieved.length === 0
      ? { action: 'escalate', reasons: ['no_relevant_articles'] }
      : null;
  }

  checkAnswer(result: ResponderResult, validation: ValidationResult | null): Verdict {
    if (!result.ok || validation === null) {
      return { action: 'escalate', reasons: ['answer_llm_failed'] };
    }
    const reasons: Reason[] = [...new Set(validation.issues.map((issue) => issue.code))];
    if (validation.answer && validation.answer.confidence < this.options.minAnswerConfidence) {
      reasons.push('low_answer_confidence');
    }
    if (reasons.length > 0) {
      return { action: 'escalate', reasons };
    }
    return { action: 'reply', reasons: ['answered_from_knowledge_base'] };
  }
}
