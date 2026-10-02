CREATE TABLE `ai_failures` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`game_id` text NOT NULL,
	`state_version` integer NOT NULL,
	`actor` text NOT NULL,
	`request_type` text NOT NULL,
	`stage` text NOT NULL,
	`error_code` text NOT NULL,
	`policy_version` text NOT NULL,
	`model` text NOT NULL,
	`latency_ms` integer NOT NULL,
	`at` text NOT NULL
);
