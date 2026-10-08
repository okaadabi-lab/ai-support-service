import type { Article } from '../knowledge/knowledge-base.js';
import { normalizeText } from '../retrieval/tokenizer.js';
import { extractAmounts } from './amounts.js';
import { type Answer, answerSchema } from './responder.js';
import type { Reason } from './types.js';

export interface ValidationIssue {
  code: Reason;
  detail: string;
}

export type ValidationResult =
  | { ok: true; answer: Answer; issues: [] }
  | { ok: false; answer: Answer | null; issues: ValidationIssue[] };

interface ForbiddenRule {
  id: string;
  pattern: RegExp;
}

// Commitments only an admin may make. Matching is intentionally broad: a false positive
// escalates to a human, a false negative sends a promise the business may not keep.
export const FORBIDDEN_PROMISES: ForbiddenRule[] = [
  {
    id: 'guaranteed_refund',
    pattern:
      /(\b(pasti|dijamin|jamin|garansi|guarantee[ds]?|definitely)\b|100%)[^.!?\n]{0,40}\b(refund|dikembalikan|uang(nya)? (kembali|balik)|money back)/,
  },
  {
    id: 'guaranteed_refund',
    pattern: /\b(refund|money back)\b[^.!?\n]{0,30}\b(pasti|dijamin|guaranteed|for sure)\b/,
  },
  {
    id: 'confirmed_booking',
    pattern:
      /\b(sudah|udah|telah) (kami|saya|aku) (kunci|kuncikan|booking|book|konfirmasi|tahan|amankan|ganti|ubah|pindah|reschedule)\b/,
  },
  {
    id: 'confirmed_booking',
    pattern:
      /\b(sudah|udah|telah) (dikunci|dibooking|dikonfirmasi|ditahan|diamankan|diganti|diubah|dipindah|direschedule)\b/,
  },
  {
    id: 'confirmed_booking',
    pattern: /\b(i|we)('ve| have) (booked|reserved|confirmed|locked|rescheduled|changed)\b/,
  },
  {
    id: 'confirmed_booking',
    pattern:
      /\b(tanggal(nya)?|your date|the date) (sudah |udah |is )?(aman|confirmed|terkonfirmasi)\b/,
  },
  {
    id: 'discount_offer',
    pattern: /\b(kasih|dapat|dapet|beri|berikan|ada|kami kasih) (diskon|potongan harga|promo)\b/,
  },
  {
    id: 'discount_offer',
    pattern: /\b(give|offer|get|have) (you )?(a |an )?(special )?(discount|promo)\b/,
  },
];

export interface ValidatorOptions {
  minChars: number;
  maxChars: number;
}

export class OutputValidator {
  constructor(private readonly options: ValidatorOptions) {}

  validate(rawAnswer: unknown, retrieved: Article[]): ValidationResult {
    const parsed = answerSchema.safeParse(rawAnswer);
    if (!parsed.success) {
      return {
        ok: false,
        answer: null,
        issues: [
          { code: 'validation_schema', detail: parsed.error.issues[0]?.message ?? 'invalid' },
        ],
      };
    }
    const answer = { ...parsed.data, reply: parsed.data.reply.trim() };
    const issues = [
      ...this.checkLength(answer.reply),
      ...this.checkCitations(answer, retrieved),
      ...this.checkAmounts(answer, retrieved),
      ...this.checkPromises(answer.reply),
    ];
    return issues.length === 0 ? { ok: true, answer, issues: [] } : { ok: false, answer, issues };
  }

  private checkLength(reply: string): ValidationIssue[] {
    if (reply.length < this.options.minChars) {
      return [{ code: 'validation_reply_too_short', detail: `${reply.length} chars` }];
    }
    if (reply.length > this.options.maxChars) {
      return [{ code: 'validation_reply_too_long', detail: `${reply.length} chars` }];
    }
    return [];
  }

  private checkCitations(answer: Answer, retrieved: Article[]): ValidationIssue[] {
    if (answer.cited_article_ids.length === 0) {
      return [{ code: 'validation_no_citations', detail: 'reply cites no article' }];
    }
    const retrievedIds = new Set(retrieved.map((article) => article.id));
    return answer.cited_article_ids
      .filter((id) => !retrievedIds.has(id))
      .map((id) => ({ code: 'validation_citation_not_retrieved' as const, detail: id }));
  }

  private checkAmounts(answer: Answer, retrieved: Article[]): ValidationIssue[] {
    const cited = new Set(answer.cited_article_ids);
    const allowed = new Set<string>();
    for (const article of retrieved) {
      if (cited.has(article.id)) {
        for (const key of extractAmounts(`${article.title}\n${article.body}`)) {
          allowed.add(key);
        }
      }
    }
    return [...extractAmounts(answer.reply)]
      .filter((key) => !allowed.has(key))
      .map((key) => ({ code: 'validation_unsupported_amount' as const, detail: key }));
  }

  private checkPromises(reply: string): ValidationIssue[] {
    const normalized = normalizeText(reply);
    const matched = new Set(
      FORBIDDEN_PROMISES.filter((rule) => rule.pattern.test(normalized)).map((rule) => rule.id),
    );
    return [...matched].map((id) => ({
      code: 'validation_forbidden_promise' as const,
      detail: id,
    }));
  }
}
