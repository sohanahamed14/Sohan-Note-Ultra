CREATE TABLE `cash_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`shop_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`created_by` text,
	`dirty` integer DEFAULT 1 NOT NULL,
	`amount` integer NOT NULL,
	`type` text NOT NULL,
	`method` text DEFAULT 'cash' NOT NULL,
	`ref_id` text,
	`date` integer NOT NULL,
	`note` text
);
--> statement-breakpoint
CREATE INDEX `cash_shop_date_idx` ON `cash_entries` (`shop_id`,`date`);--> statement-breakpoint
CREATE INDEX `cash_ref_idx` ON `cash_entries` (`ref_id`);--> statement-breakpoint
CREATE INDEX `cash_type_idx` ON `cash_entries` (`shop_id`,`type`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`shop_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`created_by` text,
	`dirty` integer DEFAULT 1 NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `categories_shop_idx` ON `categories` (`shop_id`,`kind`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`shop_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`created_by` text,
	`dirty` integer DEFAULT 1 NOT NULL,
	`category_id` text,
	`amount` integer NOT NULL,
	`date` integer NOT NULL,
	`method` text DEFAULT 'cash' NOT NULL,
	`note` text
);
--> statement-breakpoint
CREATE INDEX `expenses_shop_date_idx` ON `expenses` (`shop_id`,`date`);--> statement-breakpoint
CREATE INDEX `expenses_category_idx` ON `expenses` (`category_id`);--> statement-breakpoint
CREATE TABLE `kv` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `online_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`shop_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`created_by` text,
	`dirty` integer DEFAULT 1 NOT NULL,
	`order_no` text NOT NULL,
	`customer_name` text NOT NULL,
	`phone` text NOT NULL,
	`address` text NOT NULL,
	`items_json` text NOT NULL,
	`subtotal` integer NOT NULL,
	`delivery_charge` integer DEFAULT 0 NOT NULL,
	`total` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`sale_id` text
);
--> statement-breakpoint
CREATE INDEX `orders_shop_status_idx` ON `online_orders` (`shop_id`,`status`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `parties` (
	`id` text PRIMARY KEY NOT NULL,
	`shop_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`created_by` text,
	`dirty` integer DEFAULT 1 NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`address` text,
	`note` text
);
--> statement-breakpoint
CREATE INDEX `parties_shop_idx` ON `parties` (`shop_id`,`type`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `parties_phone_idx` ON `parties` (`phone`);--> statement-breakpoint
CREATE TABLE `party_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`shop_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`created_by` text,
	`dirty` integer DEFAULT 1 NOT NULL,
	`party_id` text NOT NULL,
	`amount` integer NOT NULL,
	`type` text NOT NULL,
	`ref_id` text,
	`date` integer NOT NULL,
	`note` text
);
--> statement-breakpoint
CREATE INDEX `ledger_party_idx` ON `party_ledger` (`party_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `ledger_ref_idx` ON `party_ledger` (`ref_id`);--> statement-breakpoint
CREATE INDEX `ledger_shop_date_idx` ON `party_ledger` (`shop_id`,`date`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`shop_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`created_by` text,
	`dirty` integer DEFAULT 1 NOT NULL,
	`name` text NOT NULL,
	`category_id` text,
	`unit` text DEFAULT 'pcs' NOT NULL,
	`code` text,
	`buy_price` integer DEFAULT 0 NOT NULL,
	`sell_price` integer DEFAULT 0 NOT NULL,
	`wholesale_price` integer DEFAULT 0 NOT NULL,
	`low_stock_alert` real DEFAULT 0 NOT NULL,
	`warranty_days` integer DEFAULT 0 NOT NULL,
	`image_uri` text,
	`description` text,
	`online_visible` integer DEFAULT 0 NOT NULL,
	`featured` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `products_shop_idx` ON `products` (`shop_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `products_category_idx` ON `products` (`category_id`);--> statement-breakpoint
CREATE INDEX `products_dirty_idx` ON `products` (`dirty`);--> statement-breakpoint
CREATE TABLE `purchase_items` (
	`id` text PRIMARY KEY NOT NULL,
	`shop_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`created_by` text,
	`dirty` integer DEFAULT 1 NOT NULL,
	`purchase_id` text NOT NULL,
	`product_id` text,
	`name` text NOT NULL,
	`qty` real NOT NULL,
	`unit_price` integer NOT NULL,
	`total` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `purchase_items_purchase_idx` ON `purchase_items` (`purchase_id`);--> statement-breakpoint
CREATE INDEX `purchase_items_product_idx` ON `purchase_items` (`product_id`);--> statement-breakpoint
CREATE TABLE `purchases` (
	`id` text PRIMARY KEY NOT NULL,
	`shop_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`created_by` text,
	`dirty` integer DEFAULT 1 NOT NULL,
	`bill_no` text NOT NULL,
	`party_id` text,
	`date` integer NOT NULL,
	`subtotal` integer NOT NULL,
	`discount` integer DEFAULT 0 NOT NULL,
	`vat` integer DEFAULT 0 NOT NULL,
	`total` integer NOT NULL,
	`paid` integer DEFAULT 0 NOT NULL,
	`due` integer DEFAULT 0 NOT NULL,
	`method` text DEFAULT 'cash' NOT NULL,
	`note` text
);
--> statement-breakpoint
CREATE INDEX `purchases_shop_date_idx` ON `purchases` (`shop_id`,`date`);--> statement-breakpoint
CREATE INDEX `purchases_party_idx` ON `purchases` (`party_id`);--> statement-breakpoint
CREATE TABLE `sale_items` (
	`id` text PRIMARY KEY NOT NULL,
	`shop_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`created_by` text,
	`dirty` integer DEFAULT 1 NOT NULL,
	`sale_id` text NOT NULL,
	`product_id` text,
	`name` text NOT NULL,
	`qty` real NOT NULL,
	`unit_price` integer NOT NULL,
	`buy_price` integer DEFAULT 0 NOT NULL,
	`total` integer NOT NULL,
	`warranty_until` integer
);
--> statement-breakpoint
CREATE INDEX `sale_items_sale_idx` ON `sale_items` (`sale_id`);--> statement-breakpoint
CREATE INDEX `sale_items_product_idx` ON `sale_items` (`product_id`);--> statement-breakpoint
CREATE TABLE `sales` (
	`id` text PRIMARY KEY NOT NULL,
	`shop_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`created_by` text,
	`dirty` integer DEFAULT 1 NOT NULL,
	`invoice_no` text NOT NULL,
	`party_id` text,
	`date` integer NOT NULL,
	`subtotal` integer NOT NULL,
	`discount` integer DEFAULT 0 NOT NULL,
	`vat` integer DEFAULT 0 NOT NULL,
	`total` integer NOT NULL,
	`paid` integer DEFAULT 0 NOT NULL,
	`due` integer DEFAULT 0 NOT NULL,
	`method` text DEFAULT 'cash' NOT NULL,
	`note` text,
	`kind` text DEFAULT 'pos' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sales_shop_date_idx` ON `sales` (`shop_id`,`date`);--> statement-breakpoint
CREATE INDEX `sales_party_idx` ON `sales` (`party_id`);--> statement-breakpoint
CREATE INDEX `sales_invoice_idx` ON `sales` (`shop_id`,`invoice_no`);--> statement-breakpoint
CREATE TABLE `shop_members` (
	`id` text PRIMARY KEY NOT NULL,
	`shop_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`created_by` text,
	`dirty` integer DEFAULT 1 NOT NULL,
	`user_id` text,
	`email` text NOT NULL,
	`name` text,
	`role` text NOT NULL,
	`status` text DEFAULT 'invited' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `members_shop_idx` ON `shop_members` (`shop_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `members_email_idx` ON `shop_members` (`email`);--> statement-breakpoint
CREATE TABLE `shops` (
	`id` text PRIMARY KEY NOT NULL,
	`shop_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`created_by` text,
	`dirty` integer DEFAULT 1 NOT NULL,
	`name` text NOT NULL,
	`slug` text,
	`phone` text,
	`address` text,
	`business_type` text,
	`logo_uri` text,
	`vat_percent` real DEFAULT 0 NOT NULL,
	`invoice_footer` text,
	`payment_qr_uri` text,
	`decimal_enabled` integer DEFAULT 0 NOT NULL,
	`online_enabled` integer DEFAULT 0 NOT NULL,
	`online_theme` text,
	`delivery_inside` integer DEFAULT 0 NOT NULL,
	`delivery_outside` integer DEFAULT 0 NOT NULL,
	`shop_policy` text,
	`owner_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `shops_owner_idx` ON `shops` (`owner_id`);--> statement-breakpoint
CREATE INDEX `shops_slug_idx` ON `shops` (`slug`);--> statement-breakpoint
CREATE TABLE `stock_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`shop_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`created_by` text,
	`dirty` integer DEFAULT 1 NOT NULL,
	`product_id` text NOT NULL,
	`qty` real NOT NULL,
	`type` text NOT NULL,
	`ref_id` text,
	`note` text,
	`date` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `stock_product_idx` ON `stock_movements` (`product_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `stock_ref_idx` ON `stock_movements` (`ref_id`);--> statement-breakpoint
CREATE INDEX `stock_shop_date_idx` ON `stock_movements` (`shop_id`,`date`);--> statement-breakpoint
CREATE TABLE `sync_state` (
	`key` text PRIMARY KEY NOT NULL,
	`cursor` integer DEFAULT 0 NOT NULL,
	`last_synced_at` integer
);
