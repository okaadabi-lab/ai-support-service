# Configuration and evaluation

Setup steps are in the [README](../README.md#getting-started).

## Configuration

All variables with defaults are listed in [`.env.example`](../.env.example). `.env` is loaded
automatically when present; real environment variables take precedence. The ones that change
behaviour most:

| Variable                                                | Default                    | Effect                                                       |
| ------------------------------------------------------- | -------------------------- | ------------------------------------------------------------ |
| `LLM_PROVIDER`                                          | `fake`                     | `fake` or `anthropic`                                        |
| `LLM_MODEL`                                             | `claude-haiku-5-5`         | Model id sent to the API                                     |
| `LLM_PRICE_INPUT_PER_MTOK`, `LLM_PRICE_OUTPUT_PER_MTOK` | `0`                        | USD per million tokens for cost estimates                    |
| `LLM_TIMEOUT_MS`, `LLM_MAX_ATTEMPTS`                    | `15000`, `3`               | Per-attempt timeout and attempts per LLM call                |
| `MIN_CLASSIFIER_CONFIDENCE`, `MIN_ANSWER_CONFIDENCE`    | `0.6`, `0.7`               | Escalation thresholds                                        |
| `RETRIEVAL_MIN_SCORE`, `RETRIEVAL_TOP_K`                | `2.5`, `3`                 | BM25 cut-off and number of articles given to the model       |
| `HISTORY_TOKEN_BUDGET`                                  | `1500`                     | Earlier turns sent to the model, estimated as characters / 4 |
| `CLASSIFY_PROMPT_VERSION`, `ANSWER_PROMPT_VERSION`      | `classify.v1`, `answer.v1` | Prompt file in `prompts/`                                    |
| `LOG_CUSTOMER_TEXT`                                     | `false`                    | Include message text in decision logs                        |

## Evaluating the classifier

```bash
LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=... npm run eval
```

Runs the classifier over [`data/eval/intents.jsonl`](../data/eval/intents.jsonl) (30 fictional,
labelled messages: casual and formal Indonesian, some English) and prints intent and language
accuracy, a confusion summary, the misclassified messages, and token usage. Results depend on the
model and prompt version, so none are quoted here; run it after changing either. With the default
fake provider it measures only the keyword rules.
