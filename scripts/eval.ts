import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { loadConfig, loadEnvFile } from '../src/config.js';
import { createProvider, retryOptionsFrom } from '../src/container.js';
import { PromptRegistry } from '../src/llm/prompts.js';
import { IntentClassifier } from '../src/pipeline/classifier.js';
import { INTENTS, type Intent } from '../src/pipeline/types.js';

const exampleSchema = z.object({
  text: z.string().min(1),
  intent: z.enum(INTENTS),
  language: z.enum(['id', 'en']),
});

const datasetPath = process.argv[2] ?? 'data/eval/intents.jsonl';
const examples = readFileSync(datasetPath, 'utf8')
  .split('\n')
  .filter((line) => line.trim().length > 0)
  .map((line, index) => {
    const parsed = exampleSchema.safeParse(JSON.parse(line));
    if (!parsed.success) {
      throw new Error(
        `${datasetPath}:${index + 1}: ${parsed.error.issues[0]?.message ?? 'invalid'}`,
      );
    }
    return parsed.data;
  });

loadEnvFile();
const config = loadConfig();
const provider = createProvider(config);
const classifier = new IntentClassifier({
  provider,
  prompts: new PromptRegistry(config.promptsDir),
  promptVersion: config.prompts.classifyVersion,
  retry: retryOptionsFrom(config),
  maxOutputTokens: config.llm.maxOutputTokens,
});

console.log(
  `Evaluating ${examples.length} examples with provider=${provider.name} model=${provider.model} prompt=${config.prompts.classifyVersion}`,
);
if (provider.name === 'fake') {
  console.log(
    'Note: the fake provider uses keyword rules; set LLM_PROVIDER=anthropic to evaluate the model.',
  );
}

const confusion = new Map<Intent, Map<Intent, number>>();
let correctIntent = 0;
let correctLanguage = 0;
let fallbacks = 0;
let inputTokens = 0;
let outputTokens = 0;
const misses: string[] = [];

for (const example of examples) {
  const result = await classifier.classify(example.text, []);
  inputTokens += result.usage.inputTokens;
  outputTokens += result.usage.outputTokens;
  if (result.source === 'fallback') {
    fallbacks++;
  }
  if (result.intent === example.intent) {
    correctIntent++;
  } else {
    misses.push(
      `  expected ${example.intent}, got ${result.intent} (${result.confidence.toFixed(2)}): ${example.text}`,
    );
  }
  if (result.language === example.language) {
    correctLanguage++;
  }
  const row = confusion.get(example.intent) ?? new Map<Intent, number>();
  row.set(result.intent, (row.get(result.intent) ?? 0) + 1);
  confusion.set(example.intent, row);
}

const pct = (n: number) => `${((n / examples.length) * 100).toFixed(1)}%`;
console.log(`\nIntent accuracy:   ${correctIntent}/${examples.length} (${pct(correctIntent)})`);
console.log(`Language accuracy: ${correctLanguage}/${examples.length} (${pct(correctLanguage)})`);
console.log(`Fallback used:     ${fallbacks}`);
const cost =
  (inputTokens * config.llm.priceInputPerMTok + outputTokens * config.llm.priceOutputPerMTok) /
  1_000_000;
console.log(
  `Tokens:            ${inputTokens} in / ${outputTokens} out (estimated cost $${cost.toFixed(4)})`,
);

console.log('\nConfusion (expected -> predicted counts):');
for (const intent of INTENTS) {
  const row = confusion.get(intent);
  if (!row) {
    continue;
  }
  const cells = [...row.entries()].map(([predicted, count]) => `${predicted}=${count}`).join(', ');
  console.log(`  ${intent.padEnd(22)} ${cells}`);
}

if (misses.length > 0) {
  console.log('\nMisclassified:');
  console.log(misses.join('\n'));
}
