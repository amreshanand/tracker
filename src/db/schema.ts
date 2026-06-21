import {
  pgTable,
  serial,
  text,
  varchar,
  timestamp,
  boolean,
  integer,
  doublePrecision,
  uniqueIndex,
  index,
  jsonb,
} from "drizzle-orm/pg-core";

export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 500 }).notNull(),
  url: text("url").notNull(),
  platform: varchar("platform", { length: 100 }).notNull().default("unknown"),
  imageUrl: text("image_url"),
  price: varchar("price", { length: 100 }),
  description: text("description"),
  lastScrapedAt: timestamp("last_scraped_at"),
  scrapeError: text("scrape_error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const alerts = pgTable("alerts", {
  id: serial("id").primaryKey(),
  userName: varchar("user_name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  pincode: varchar("pincode", { length: 10 }).notNull(),
  productId: integer("product_id")
    .references(() => products.id, { onDelete: "cascade" })
    .notNull(),
  targetPrice: doublePrecision("target_price"),
  notified: boolean("notified").default(false).notNull(),
  processing: boolean("processing").default(false).notNull(),
  processingUntil: timestamp("processing_until"),
  retryCount: integer("retry_count").default(0).notNull(),
  lastError: text("last_error"),
  active: boolean("active").default(true).notNull(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  verificationToken: varchar("verification_token", { length: 64 }),
  traceId: varchar("trace_id", { length: 36 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  notifiedAt: timestamp("notified_at"),
}, (table) => [
  uniqueIndex("alerts_dedup_idx").on(table.email, table.productId, table.pincode),
  index("alerts_processing_idx").on(table.processing),
  index("alerts_active_idx").on(table.active),
]);

export const availability = pgTable(
  "availability",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id")
      .references(() => products.id, { onDelete: "cascade" })
      .notNull(),
    pincode: varchar("pincode", { length: 10 }).notNull(),
    city: varchar("city", { length: 255 }).notNull(),
    state: varchar("state", { length: 255 }),
    available: boolean("available").default(false).notNull(),
    lastChecked: timestamp("last_checked").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("availability_product_pincode_idx").on(
      table.productId,
      table.pincode
    ),
  ]
);

export const notificationLog = pgTable("notification_log", {
  id: serial("id").primaryKey(),
  alertId: integer("alert_id")
    .references(() => alerts.id, { onDelete: "cascade" })
    .notNull(),
  productId: integer("product_id")
    .references(() => products.id, { onDelete: "cascade" })
    .notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  deliveryId: varchar("delivery_id", { length: 64 }).notNull().unique(),
  subject: varchar("subject", { length: 500 }).notNull(),
  body: text("body").notNull(),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
  status: varchar("status", { length: 50 }).notNull().default("pending"),
  retryCount: integer("retry_count").default(0).notNull(),
  lastError: text("last_error"),
});

export const analyticsEvents = pgTable("analytics_events", {
  id: serial("id").primaryKey(),
  event: varchar("event", { length: 100 }).notNull(),
  email: varchar("email", { length: 255 }),
  productId: integer("product_id"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("analytics_events_created_at_idx").on(table.createdAt),
]);

export const userUsage = pgTable("user_usage", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  plan: varchar("plan", { length: 50 }).notNull().default("free"),
  activeAlerts: integer("active_alerts").default(0).notNull(),
  totalAlertsCreated: integer("total_alerts_created").default(0).notNull(),
  totalNotificationsSent: integer("total_notifications_sent").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const deadLetterQueue = pgTable("dead_letter_queue", {
  id: serial("id").primaryKey(),
  alertId: integer("alert_id")
    .references(() => alerts.id, { onDelete: "cascade" }),
  email: varchar("email", { length: 255 }).notNull(),
  productId: integer("product_id")
    .references(() => products.id, { onDelete: "cascade" }),
  pincode: varchar("pincode", { length: 10 }),
  reason: text("reason").notNull(),
  failedAt: timestamp("failed_at").defaultNow().notNull(),
  deliveryId: varchar("delivery_id", { length: 64 }),
  lastError: text("last_error"),
  retryCount: integer("retry_count").default(0).notNull(),
});

export const idempotencyKeys = pgTable("idempotency_keys", {
  id: serial("id").primaryKey(),
  key: varchar("key", { length: 128 }).notNull().unique(),
  responseStatus: integer("response_status").notNull(),
  responseBody: jsonb("response_body"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const cronLock = pgTable("cron_lock", {
  id: serial("id").primaryKey(),
  jobName: varchar("job_name", { length: 128 }).notNull().unique(),
  lockedAt: timestamp("locked_at").defaultNow().notNull(),
  lockedUntil: timestamp("locked_until").notNull(),
  instanceId: varchar("instance_id", { length: 64 }).notNull(),
});

export const circuitBreaker = pgTable("circuit_breaker", {
  id: serial("id").primaryKey(),
  provider: varchar("provider", { length: 64 }).notNull().unique(),
  state: varchar("state", { length: 20 }).notNull().default("closed"),
  failureCount: integer("failure_count").default(0).notNull(),
  lastFailureAt: timestamp("last_failure_at"),
  lastSuccessAt: timestamp("last_success_at"),
  openedAt: timestamp("opened_at"),
  halfOpenAttempts: integer("half_open_attempts").default(0).notNull(),
});

export const rateLimits = pgTable("rate_limits", {
  id: serial("id").primaryKey(),
  key: varchar("key", { length: 255 }).notNull().unique(),
  count: integer("count").default(0).notNull(),
  resetAt: timestamp("reset_at").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
