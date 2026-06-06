import {
  pgTable,
  serial,
  text,
  varchar,
  timestamp,
  boolean,
  integer,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 500 }).notNull(),
  url: text("url").notNull(),
  platform: varchar("platform", { length: 100 }).notNull().default("unknown"),
  imageUrl: text("image_url"),
  price: varchar("price", { length: 100 }),
  description: text("description"),
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
  notified: boolean("notified").default(false).notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  notifiedAt: timestamp("notified_at"),
});

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
  subject: varchar("subject", { length: 500 }).notNull(),
  body: text("body").notNull(),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
  status: varchar("status", { length: 50 }).notNull().default("sent"),
});
