-- Phase 1 identity migration for corte-web.
-- Creates users + chat_links tables used as the auth source of truth.

CREATE TABLE IF NOT EXISTS `{{BQ_PROJECT_ID}}.{{BQ_DATASET}}.users` (
  user_id STRING NOT NULL,
  email STRING NOT NULL,
  created_at TIMESTAMP NOT NULL,
  last_seen_at TIMESTAMP,
  metadata JSON
)
PARTITION BY DATE(created_at);

CREATE TABLE IF NOT EXISTS `{{BQ_PROJECT_ID}}.{{BQ_DATASET}}.chat_links` (
  chat_id STRING NOT NULL,
  user_id STRING NOT NULL,
  provider STRING,
  status STRING NOT NULL,
  created_at TIMESTAMP NOT NULL,
  last_seen_at TIMESTAMP,
  metadata JSON
)
PARTITION BY DATE(created_at)
CLUSTER BY chat_id, user_id;
