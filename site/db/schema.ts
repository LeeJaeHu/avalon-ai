// Intentionally empty by default.
// Add Drizzle tables here when the site actually needs a database.
// See examples/d1/db/schema.ts for an opt-in example.
import { sqliteTable, text, integer, uniqueIndex,index } from 'drizzle-orm/sqlite-core';

export const modelUsage=sqliteTable('model_usage',{
  id:text('id').primaryKey(),gameId:text('game_id').notNull(),stateVersion:integer('state_version').notNull(),detail:text('detail').notNull(),at:text('at').notNull(),
},table=>[index('model_usage_game').on(table.gameId)]);
export const aiLocks=sqliteTable('ai_locks',{
  gameId:text('game_id').primaryKey(),owner:text('owner').notNull(),expiresAt:integer('expires_at').notNull(),
});

export const games = sqliteTable('games', {
  id: text('id').primaryKey(),
  version: integer('version').notNull(),
  state: text('state').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const events = sqliteTable('events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  gameId: text('game_id').notNull(),
  version: integer('version').notNull(),
  actor: text('actor').notNull(),
  type: text('type').notNull(),
  detail: text('detail').notNull(),
  at: text('at').notNull(),
}, table => [uniqueIndex('events_game_version').on(table.gameId, table.version)]);

export const aiFailures = sqliteTable('ai_failures', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  gameId: text('game_id').notNull(),
  stateVersion: integer('state_version').notNull(),
  actor: text('actor').notNull(),
  requestType: text('request_type').notNull(),
  stage: text('stage').notNull(),
  errorCode: text('error_code').notNull(),
  policyVersion: text('policy_version').notNull(),
  model: text('model').notNull(),
  latencyMs: integer('latency_ms').notNull(),
  at: text('at').notNull(),
});
