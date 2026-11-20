ALTER TABLE `online_orders` ADD `note` text;--> statement-breakpoint
ALTER TABLE `online_orders` ADD `area` text;--> statement-breakpoint
ALTER TABLE `shops` ADD `online_visits` integer DEFAULT 0 NOT NULL;