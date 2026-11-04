-- Conversation-graph relational schema (property graph -> postgres).
CREATE TABLE guilds (
  guild_id BIGINT PRIMARY KEY, name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE channels (
  channel_id BIGINT PRIMARY KEY,
  guild_id BIGINT NOT NULL REFERENCES guilds(guild_id),
  name TEXT NOT NULL, channel_type TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE users (
  user_id BIGINT PRIMARY KEY, display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(), last_seen_at TIMESTAMPTZ);
CREATE TYPE privacy_level AS ENUM
  ('public_channel','member_channel','private_thread','direct_message','restricted');
CREATE TABLE conversations (
  conversation_id BIGSERIAL PRIMARY KEY,
  topic_label TEXT, activity_score DOUBLE PRECISION DEFAULT 0,
  parent_conversation BIGINT,
  created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());
CREATE INDEX idx_conv_activity ON conversations(updated_at DESC);
CREATE TABLE messages (
  message_id BIGINT PRIMARY KEY,
  guild_id BIGINT NOT NULL REFERENCES guilds(guild_id),
  channel_id BIGINT NOT NULL REFERENCES channels(channel_id),
  author_id BIGINT NOT NULL REFERENCES users(user_id),
  conversation_id BIGINT REFERENCES conversations(conversation_id),
  thread_id BIGINT, content TEXT, created_at TIMESTAMPTZ NOT NULL,
  embedding_id UUID,
  reply_to_message_id BIGINT REFERENCES messages(message_id),
  privacy_level privacy_level NOT NULL DEFAULT 'public_channel',
  deleted_at TIMESTAMPTZ);
CREATE INDEX idx_msg_conv ON messages(conversation_id, created_at);
CREATE INDEX idx_msg_reply ON messages(reply_to_message_id);
CREATE TABLE message_mentions (
  message_id BIGINT NOT NULL REFERENCES messages(message_id),
  user_id BIGINT NOT NULL REFERENCES users(user_id),
  PRIMARY KEY (message_id, user_id));
CREATE TYPE edge_type AS ENUM
  ('reply_to','related_to','addresses','follows','belongs_to');
CREATE TABLE graph_edges (
  edge_id BIGSERIAL PRIMARY KEY,
  source_message_id BIGINT NOT NULL REFERENCES messages(message_id),
  target_message_id BIGINT REFERENCES messages(message_id),
  edge_type edge_type NOT NULL, confidence DOUBLE PRECISION NOT NULL,
  semantic_score DOUBLE PRECISION, temporal_score DOUBLE PRECISION,
  mention_score DOUBLE PRECISION, created_at TIMESTAMPTZ DEFAULT now());
CREATE INDEX idx_edge_src ON graph_edges(source_message_id);
CREATE TABLE conversation_membership (
  conversation_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  participation_score REAL DEFAULT 0,
  direct_messages INTEGER DEFAULT 0, replies INTEGER DEFAULT 0,
  mentions INTEGER DEFAULT 0, last_contribution TIMESTAMPTZ,
  PRIMARY KEY (conversation_id, user_id));
CREATE TABLE message_acl (
  message_id BIGINT NOT NULL REFERENCES messages(message_id),
  principal_type TEXT NOT NULL, principal_id BIGINT NOT NULL,
  can_read BOOLEAN NOT NULL, can_summarize BOOLEAN NOT NULL,
  PRIMARY KEY (message_id, principal_type, principal_id));
CREATE TABLE retention_policies (
  policy_id BIGSERIAL PRIMARY KEY,
  guild_id BIGINT, channel_id BIGINT, retain_days INTEGER NOT NULL,
  store_embeddings BOOLEAN NOT NULL, store_content BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE deletion_tombstones (
  entity_type TEXT NOT NULL, entity_id BIGINT NOT NULL,
  reason TEXT NOT NULL, deleted_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (entity_type, entity_id));
CREATE TABLE privacy_requests (
  request_id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL,
  request_type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  requested_at TIMESTAMPTZ NOT NULL, completed_at TIMESTAMPTZ,
  audit_notes TEXT);
