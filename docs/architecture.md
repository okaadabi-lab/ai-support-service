# Architecture notes

The request sequence is in the [README](../README.md#architecture). This page covers the schema
and two smaller design decisions.

## Database

```mermaid
erDiagram
    conversations ||--o{ messages : has
    conversations ||--o{ decisions : has
    messages ||--o| decisions : "customer message gets one"
    conversations {
        text id PK "UUID"
        text channel "UNIQUE(channel, customer_id)"
        text customer_id
        text status "bot | human"
    }
    messages {
        int id PK
        text conversation_id FK
        text role "customer | assistant"
        text external_message_id "UNIQUE(channel, external_message_id)"
        text text
    }
    decisions {
        int id PK
        int message_id FK "UNIQUE"
        text action "reply | escalate | none"
        json reasons
        text intent
        text classifier_source "llm | fallback | skipped"
        json citations
        text classify_prompt
        text answer_prompt
        text model
        int input_tokens
        int output_tokens
        real estimated_cost_usd
        int latency_ms
        json stage_latencies
    }
    api_keys {
        int id PK
        text key_prefix "UNIQUE, safe to log"
        text key_hash "SHA-256"
        json scopes
    }
```

CHECK constraints cover enums, confidence ranges, non-negative counters and `json_valid` on JSON
columns. The schema is applied on start-up and tracked with `PRAGMA user_version`.

## Further design decisions

- **SQLite with one write transaction per message.** Enough for one instance; the idempotency key
  and the decision are written together so retries are always safe.
- **Model and prices are configuration.** Nothing in code assumes a model or current pricing.
