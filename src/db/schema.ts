const now = `(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const schemaVersion = 1;

export const schemaSql = `
CREATE TABLE IF NOT EXISTS api_keys (
  id          INTEGER PRIMARY KEY,
  name        TEXT    NOT NULL,
  key_prefix  TEXT    NOT NULL UNIQUE,
  key_hash    TEXT    NOT NULL,
  scopes      TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT ${now},
  revoked_at  TEXT
);

CREATE TABLE IF NOT EXISTS conversations (
  id             TEXT PRIMARY KEY,
  channel        TEXT NOT NULL,
  customer_id    TEXT NOT NULL,
  customer_name  TEXT,
  status         TEXT NOT NULL DEFAULT 'bot' CHECK (status IN ('bot', 'human')),
  created_at     TEXT NOT NULL DEFAULT ${now},
  updated_at     TEXT NOT NULL DEFAULT ${now},
  UNIQUE (channel, customer_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id                   INTEGER PRIMARY KEY,
  conversation_id      TEXT    NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  role                 TEXT    NOT NULL CHECK (role IN ('customer', 'assistant')),
  text                 TEXT    NOT NULL,
  channel              TEXT    NOT NULL,
  external_message_id  TEXT,
  received_at          TEXT,
  created_at           TEXT    NOT NULL DEFAULT ${now},
  UNIQUE (channel, external_message_id),
  CHECK (role = 'assistant' OR external_message_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages (conversation_id, id);

CREATE TABLE IF NOT EXISTS decisions (
  id                     INTEGER PRIMARY KEY,
  message_id             INTEGER NOT NULL UNIQUE REFERENCES messages (id) ON DELETE CASCADE,
  conversation_id        TEXT    NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  action                 TEXT    NOT NULL CHECK (action IN ('reply', 'escalate', 'none')),
  reply_text             TEXT,
  reasons                TEXT    NOT NULL CHECK (json_valid(reasons)),
  intent                 TEXT,
  language               TEXT    CHECK (language IN ('id', 'en')),
  classifier_source      TEXT    NOT NULL CHECK (classifier_source IN ('llm', 'fallback', 'skipped')),
  classifier_confidence  REAL    CHECK (classifier_confidence BETWEEN 0 AND 1),
  answer_confidence      REAL    CHECK (answer_confidence BETWEEN 0 AND 1),
  confidence             REAL    CHECK (confidence BETWEEN 0 AND 1),
  citations              TEXT    NOT NULL CHECK (json_valid(citations)),
  retrieved              TEXT    NOT NULL CHECK (json_valid(retrieved)),
  classify_prompt        TEXT,
  answer_prompt          TEXT,
  model                  TEXT,
  input_tokens           INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens          INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  estimated_cost_usd     REAL    NOT NULL DEFAULT 0 CHECK (estimated_cost_usd >= 0),
  latency_ms             INTEGER NOT NULL CHECK (latency_ms >= 0),
  stage_latencies        TEXT    NOT NULL CHECK (json_valid(stage_latencies)),
  created_at             TEXT    NOT NULL DEFAULT ${now}
);

CREATE INDEX IF NOT EXISTS idx_decisions_created_at ON decisions (created_at);
CREATE INDEX IF NOT EXISTS idx_decisions_conversation ON decisions (conversation_id);
`;
