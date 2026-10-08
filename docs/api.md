# API reference

Base URL (local): `http://localhost:8083`. All `/v1` endpoints require
`Authorization: Bearer <api key>` with the scope listed. Request and response bodies are JSON.

| Method | Path                            | Scope            | Purpose                                       |
| ------ | ------------------------------- | ---------------- | --------------------------------------------- |
| POST   | `/v1/messages`                  | `messages:write` | Process one inbound customer message          |
| POST   | `/v1/conversations/:id/handoff` | `messages:write` | Agent takes over (`human`) or returns (`bot`) |
| GET    | `/v1/conversations/:id`         | `admin:read`     | Messages and decisions of a conversation      |
| GET    | `/v1/metrics?from&to`           | `admin:read`     | Intents, escalations, latency, tokens, cost   |
| GET    | `/health`                       | none             | Liveness and database check                   |

Keys are created with `npm run create-key -- --name <label> --scopes <scope,...>`.

## Errors

Every error has the same shape:

```json
{
  "error": {
    "code": "validation_failed",
    "message": "Request validation failed",
    "details": [{ "path": "text", "message": "..." }]
  }
}
```

| Status | `code`              | When                                                           |
| ------ | ------------------- | -------------------------------------------------------------- |
| 400    | `validation_failed` | Body, path or query failed validation (`details` lists fields) |
| 401    | `unauthorized`      | Missing, malformed, unknown or revoked key                     |
| 403    | `forbidden`         | Key lacks the route's scope                                    |
| 404    | `not_found`         | Unknown conversation or route                                  |
| 429    | `rate_limited`      | Per-key or per-customer limit hit; see `Retry-After`           |
| 500    | `internal_error`    | Unexpected failure; details are only in server logs            |

An LLM outage is **not** an error: the message is escalated with a reason and the call returns 201.

## Request ids

Send `X-Request-Id` (1-64 chars of `A-Z a-z 0-9 . _ -`) to have it used in every log line for the
request; it is echoed in the response. Otherwise a UUID is generated.

## POST /v1/messages

Request:

```json
{
  "channel": "whatsapp",
  "external_message_id": "wamid.HBgLNjI4MTIwMDAwMDAxFQIAEhgg",
  "customer_id": "6281200000001",
  "customer_name": "Rina",
  "text": "kak brp harga paket anggrek?",
  "received_at": "2026-10-09T10:00:00+07:00"
}
```

| Field                 | Rules                                                                     |
| --------------------- | ------------------------------------------------------------------------- |
| `channel`             | lowercase, `^[a-z][a-z0-9_-]{1,31}$` (e.g. `whatsapp`, `instagram`)       |
| `external_message_id` | 1-128 chars; the channel's own message id. Idempotency key with `channel` |
| `customer_id`         | 1-128 chars; stable per customer on that channel                          |
| `customer_name`       | optional, 1-120 chars                                                     |
| `text`                | 1-4000 chars after trimming                                               |
| `received_at`         | ISO-8601 date-time with offset                                            |

Response (`201` when processed now, `200` when replayed; header `Idempotent-Replayed: true|false`):

```json
{
  "conversation_id": "f3b46189-6cf0-4913-9a2e-157743fc340c",
  "action": "reply",
  "reply_text": "Paket Anggrek Rp 12.500.000 kak, untuk sampai 150 tamu ...",
  "reasons": ["answered_from_knowledge_base"],
  "intent": "pricing_question",
  "confidence": 0.85,
  "citations": [{ "article_id": "paket-dan-harga", "title": "Paket dekorasi dan harga" }]
}
```

| `action`   | Meaning for the caller                                                                                   |
| ---------- | -------------------------------------------------------------------------------------------------------- |
| `reply`    | Send `reply_text` to the customer.                                                                       |
| `escalate` | Send `reply_text` (a short holding message) and notify a human. The conversation is now in `human` mode. |
| `none`     | A human is handling this conversation. Send nothing; `reply_text` is `null`.                             |

`confidence` is the answer confidence for drafted answers, otherwise the classifier confidence,
and `null` when nothing was classified. `intent` is `null` for `none`.

### Reason codes

| Reason                                                                                                                                                                                                          | Action     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `answered_from_knowledge_base`                                                                                                                                                                                  | `reply`    |
| `greeting_template`                                                                                                                                                                                             | `reply`    |
| `human_handoff_active`                                                                                                                                                                                          | `none`     |
| `intent_complaint`, `intent_refund_request`, `intent_human_request`                                                                                                                                             | `escalate` |
| `low_classifier_confidence`                                                                                                                                                                                     | `escalate` |
| `classifier_llm_failed` (keyword fallback was used)                                                                                                                                                             | `escalate` |
| `no_relevant_articles`                                                                                                                                                                                          | `escalate` |
| `answer_llm_failed`                                                                                                                                                                                             | `escalate` |
| `low_answer_confidence`                                                                                                                                                                                         | `escalate` |
| `validation_schema`, `validation_no_citations`, `validation_citation_not_retrieved`, `validation_unsupported_amount`, `validation_forbidden_promise`, `validation_reply_too_short`, `validation_reply_too_long` | `escalate` |

Several reasons can appear together (for example an invented price and a forbidden promise in
the same draft).

### Idempotency

`(channel, external_message_id)` is unique. Sending the same message again returns the stored
decision with status `200` and does not call the LLM. Concurrent duplicates inside one process
wait for the first one. The customer message, its decision, the outgoing text and the hand-off
switch are written in one transaction, so a retry after a crash either finds the full decision
or processes the message from scratch.

## POST /v1/conversations/:id/handoff

```json
{ "status": "human" }
```

`human` makes the bot silent for this conversation (`action: "none"`); `bot` gives it back.
Response: `{ "conversation_id": "...", "status": "bot", "updated_at": "..." }`.

## GET /v1/conversations/:id

Returns `conversation` (channel, customer, status), `messages` (customer and assistant turns in
order) and `decisions`, each with reasons, intent, language, `classifier_source`
(`llm`/`fallback`/`skipped`), both confidences, citations, retrieved article scores, prompt
versions, model, token counts, `estimated_cost_usd`, total `latency_ms` and `stage_latency_ms`.

## GET /v1/metrics

Query: `from`, `to` (ISO-8601 with offset). Defaults to the last 7 days. The window is
`from <= created_at < to`.

```json
{
  "window": { "from": "2026-10-01T00:00:00.000Z", "to": "2026-10-08T00:00:00.000Z" },
  "total_decisions": 7,
  "actions": { "reply": 4, "escalate": 2, "none": 1 },
  "escalation_rate": 0.3333,
  "escalation_reasons": { "intent_refund_request": 1, "no_relevant_articles": 1 },
  "intents": { "other": 3, "greeting": 1, "pricing_question": 1, "refund_request": 1 },
  "classifier_fallback_count": 0,
  "latency_ms": { "p50": 1, "p95": 14 },
  "tokens": { "input": 4705, "output": 263 },
  "estimated_cost_usd": 0
}
```

`escalation_rate` is `escalate / (reply + escalate)`; silent `none` decisions are excluded because
the bot did not make a choice. Percentiles use the nearest-rank method. Cost is an estimate from
the configured per-million-token prices.

## Calling this service from n8n (`omnichannel-inbox-automation`)

The n8n workflows in `omnichannel-inbox-automation` receive WhatsApp and Instagram webhooks,
normalise them, and call this service with an **HTTP Request** node:

- Method `POST`, URL `http://<host>:8083/v1/messages`
- Header `Authorization: Bearer {{ $credentials... }}` using a key with scope `messages:write`
  (store it as an n8n credential, not in the node)
- Header `X-Request-Id: {{ $execution.id }}` so logs of both systems can be joined
- Body: the request shape above, mapping the channel's message id to `external_message_id`
- Timeout: longer than `LLM_TIMEOUT_MS x LLM_MAX_ATTEMPTS` for two LLM calls plus backoff
  (about 60 s with the defaults)

A **Switch** node on `action` then routes:

| `action`   | Workflow step                                                                   |
| ---------- | ------------------------------------------------------------------------------- |
| `reply`    | Send `reply_text` through the channel API.                                      |
| `escalate` | Send `reply_text`, then notify the team (with `reasons` and `conversation_id`). |
| `none`     | Stop.                                                                           |

Error handling in the workflow:

- `5xx`, timeouts and network errors: retry with the **same** `external_message_id`. Retries are
  safe because of idempotency; a message is never answered twice.
- `429`: wait for `Retry-After` seconds, then retry.
- `400`, `401`, `403`: do not retry; alert, because the workflow or credential is wrong.

When an agent finishes, the inbox calls `POST /v1/conversations/:id/handoff` with
`{"status": "bot"}` to give the conversation back to the bot.
