// Intentionally empty by default.
// Add Drizzle tables here when the site actually needs a database.
// See examples/d1/db/schema.ts for an opt-in example.
import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';

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
