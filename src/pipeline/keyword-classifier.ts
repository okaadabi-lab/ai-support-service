import { normalizeText } from '../retrieval/tokenizer.js';
import type { Intent, Language } from './types.js';

// Ordered by priority: when a message matches several rules, the intent that must reach a
// human wins (a refund request that also mentions a price is still a refund request).
const RULES: { intent: Intent; patterns: RegExp[] }[] = [
  {
    intent: 'refund_request',
    patterns: [
      /\brefund/,
      /\bpengembalian (dana|uang|dp)\b/,
      /\b(uang|dana|dp)\w* (\w+ )?(dibalikin|dikembalikan|balik|kembali)\b/,
      /\bbalikin (uang|dana|dp)/,
      /\bmoney back\b/,
    ],
  },
  {
    intent: 'human_request',
    patterns: [
      /\b(bicara|ngomong|chat|hubungi|disambungkan|sambungkan|telpon|telepon)\b.{0,12}\b(admin|orang|cs|owner|pemilik|manusia)\b/,
      /\b(real|actual) (person|human)\b/,
      /\b(talk|speak) to (a |an )?(human|person|agent|someone)\b/,
      /\b(jangan|bukan) (bot|robot)\b/,
    ],
  },
  {
    intent: 'complaint',
    patterns: [
      /\b(kecewa|mengecewakan|komplain|complain|parah|kesal|kesel|marah|telat|terlambat|rusak|jelek|layu)\b/,
      /\b(disappoint\w*|terrible|awful|late|broken|unacceptable|flicker\w*)\b/,
    ],
  },
  {
    intent: 'booking_change',
    patterns: [
      /\b(reschedule|resched|undur|diundur|mundur)\b/,
      /\b(ganti|mengganti|ubah|mengubah|pindah)\b.{0,12}\b(tanggal|tgl|paket|lokasi|gedung|venue)\b/,
      /\b(lokasi|gedung|venue)\w* (\w+ )?pindah\b/,
      /\b(change|move|switch)\b.{0,16}\b(date|booking|package|venue)\b/,
    ],
  },
  {
    intent: 'availability_question',
    patterns: [
      /\b(tanggal|tgl)\b.*\b(kosong|tersedia|available|ready|penuh|keabisan|kehabisan)\b/,
      /\b(kosong|tersedia|available|ready)\b.*\b(tanggal|tgl)\b/,
      /\b(is|are)\b.*\b(available|free)\b/,
      /\bavailability\b/,
    ],
  },
  {
    intent: 'pricing_question',
    patterns: [
      /\b(harga|hrg|harganya|biaya|ongkos|ongkir|pricelist|price ?list|tarif)\b/,
      /(?<!\b(jam|hari|bulan|tanggal|tgl) )\b(berapa|brp)\b/,
      /\b(price|prices|pricing|cost|how much)\b/,
    ],
  },
];

// A message is a greeting when every word is a greeting or a filler word.
const GREETING_WORDS = new Set([
  'halo',
  'hallo',
  'hai',
  'hi',
  'hello',
  'hey',
  'there',
  'pagi',
  'siang',
  'sore',
  'malam',
  'selamat',
  'assalamualaikum',
  'permisi',
  'makasih',
  'terima',
  'kasih',
  'thanks',
  'thank',
  'you',
  'ya',
  'kak',
  'kakak',
  'min',
  'admin',
  'infonya',
  'banyak',
  'good',
  'morning',
  'afternoon',
  'evening',
]);

const ENGLISH_MARKERS =
  /\b(the|is|are|what|how|much|do|does|you|your|please|can|want|my|i'm|i'd|we|it|there|thanks)\b/g;
const INDONESIAN_MARKERS =
  /\b(yang|yg|apa|berapa|brp|bisa|gak|ga|nggak|kak|min|dong|ya|saya|aku|mau|untuk|tidak|sudah|udah|kalau|kalo|tanggal|harga|kami|mohon|selamat)\b/g;

export interface KeywordClassification {
  intent: Intent;
  language: Language;
  confidence: number;
}

/**
 * Used when the LLM classifier is unavailable. The policy always escalates a fallback
 * classification, so this result only labels the hand-off for the human queue and picks the
 * language of the holding message. It never authorises an automated answer.
 */
export function classifyByKeywords(text: string): KeywordClassification {
  const normalized = normalizeText(text).trim();
  const language = detectLanguage(normalized);
  for (const rule of RULES) {
    if (rule.patterns.some((pattern) => pattern.test(normalized))) {
      return { intent: rule.intent, language, confidence: 0.5 };
    }
  }
  if (isGreeting(normalized)) {
    return { intent: 'greeting', language, confidence: 0.5 };
  }
  return { intent: 'other', language, confidence: 0.2 };
}

function isGreeting(normalized: string): boolean {
  const words = normalized.split(/[^a-z]+/).filter((word) => word.length > 0);
  // Collapse stretched spellings such as "halooo" or "hiii".
  return (
    words.length > 0 && words.every((word) => GREETING_WORDS.has(word.replace(/(.)\1+$/, '$1')))
  );
}

export function detectLanguage(normalizedText: string): Language {
  const english = normalizedText.match(ENGLISH_MARKERS)?.length ?? 0;
  const indonesian = normalizedText.match(INDONESIAN_MARKERS)?.length ?? 0;
  return english > indonesian ? 'en' : 'id';
}
