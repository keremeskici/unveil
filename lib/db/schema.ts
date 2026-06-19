import {
  pgTable,
  text,
  varchar,
  decimal,
  numeric,
  integer,
  jsonb,
  timestamp,
  pgEnum,
  uuid,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const mediaTypeEnum = pgEnum("media_type", ["image", "video"]);

// How a post is gated. "full" = the whole asset is locked behind one unlock
// (today's behaviour). "partial" = the blurred clip plays free and each blurred
// region is an independent micro-unlock. See docs/media-player-implementation.md.
export const accessModeEnum = pgEnum("access_mode", ["full", "partial"]);

export const loyaltyEventTypeEnum = pgEnum("loyalty_event_type", [
  "post_unlock",
  "tip",
  "streak_bonus",
]);

// A DM is either plain text or a pay-per-view card that points at a post. PPV
// messages reuse the existing posts/unlocks/Tempo path — see lib/db/messages.ts.
export const messageKindEnum = pgEnum("message_kind", ["text", "ppv"]);

export const custodialLedgerTypeEnum = pgEnum("custodial_ledger_type", [
  "deposit",
  "unlock_debit",
  "withdrawal",
  "refund",
  // A tip moves balance fan → creator: the fan is debited, the creator credited.
  "tip_debit",
  "tip_credit",
  "mpp_call_debit",
  "mpp_call_credit",
]);

export const platformKeyStatusEnum = pgEnum("platform_key_status", [
  "active",
  "retired",
]);

export const custodialWalletStatusEnum = pgEnum("custodial_wallet_status", [
  "active",
  "retired",
]);

export const paymentDepositStatusEnum = pgEnum("payment_deposit_status", [
  "pending",
  "authorized",
  "funding_pending",
  "succeeded",
  "funding_failed",
  "failed",
  "refunded",
  "chargeback",
]);

// ── users ────────────────────────────────────────────────────────────────────
export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    walletAddress: varchar("wallet_address", { length: 42 }).unique().notNull(),
    clerkId: varchar("clerk_id", { length: 128 }).unique(),
    email: varchar("email", { length: 255 }),
    displayName: varchar("display_name", { length: 255 }),
    imageUrl: text("image_url"),
    // Tempo virtual address for per-user deposits
    tempoVirtualAddress: varchar("tempo_virtual_address", { length: 42 }).unique(),
    username: varchar("username", { length: 32 }).unique(),
    avatar: text("avatar"),
    isCreator: boolean("is_creator").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("users_wallet_idx").on(t.walletAddress),
    uniqueIndex("users_clerk_idx").on(t.clerkId),
  ],
);

// ── posts ────────────────────────────────────────────────────────────────────
export const posts = pgTable(
  "posts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 255 }).notNull(),
    // Public blurred preview — stored in Supabase Storage
    blurredPreviewUrl: text("blurred_preview_url").notNull(),
    // Private full media — stored in Supabase Storage (private), URL/key only
    privateMediaKey: text("private_media_key").notNull(),
    // Price in stablecoin units. e.g. "0.05" = 5 cents. For a "partial" post this
    // is the single price charged for EACH region reveal (no per-region price).
    unlockPrice: decimal("unlock_price", { precision: 18, scale: 8 }).notNull(),
    mediaType: mediaTypeEnum("media_type").notNull().default("image"),
    accessMode: accessModeEnum("access_mode").notNull().default("full"),
    // Blurred poster frame for video (private pathname; presigned for the feed).
    posterKey: text("poster_key"),
    durationMs: integer("duration_ms"), // video only — for the scrubber / preloading
    isPublished: boolean("is_published").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("posts_creator_idx").on(t.creatorId),
    index("posts_feed_idx").on(t.isPublished, t.createdAt),
  ],
);

// ── unlocks ──────────────────────────────────────────────────────────────────
export const unlocks = pgTable(
  "unlocks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    fanId: uuid("fan_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    // tx hash from Tempo receipt — proof of payment
    paymentTxHash: varchar("payment_tx_hash", { length: 66 }).notNull(),
    amountPaid: decimal("amount_paid", { precision: 18, scale: 8 }).notNull(),
    // how long settlement took in ms (for the "proof of magic" UI)
    settlementMs: integer("settlement_ms"),
    unlockedAt: timestamp("unlocked_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    // a fan can only unlock a given post once
    uniqueIndex("unlocks_fan_post_uniq").on(t.fanId, t.postId),
    index("unlocks_fan_idx").on(t.fanId),
  ],
);

// ── post_regions ──────────────────────────────────────────────────────────────
// One row per independently-priced blurred region on a "partial" post. The
// fully-blurred clip plays free; each region overlays a clean crop once unlocked.
// Price is NOT stored here — every region costs `posts.unlockPrice`.
export type RegionRect = { x: number; y: number; w: number; h: number }; // normalized 0..1

export const postRegions = pgTable(
  "post_regions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    label: varchar("label", { length: 64 }).notNull(), // server-side only; never shown raw
    // Union bbox across all frames, normalized 0..1 so it scales to any size.
    rect: jsonb("rect").$type<RegionRect>().notNull(),
    // Private clean crop of just this region. Presigned on unlock.
    patchMediaKey: text("patch_media_key").notNull(),
    position: integer("position").notNull().default(0), // stacking / button order
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("post_regions_post_idx").on(t.postId)],
);

// ── region_unlocks ──────────────────────────────────────────────────────────
// Per-region equivalent of `unlocks`. Separate table because `unlocks` is unique
// on (fanId, postId) and keeps meaning "owns the whole post".
export const regionUnlocks = pgTable(
  "region_unlocks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    fanId: uuid("fan_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    postRegionId: uuid("post_region_id")
      .notNull()
      .references(() => postRegions.id, { onDelete: "cascade" }),
    paymentTxHash: varchar("payment_tx_hash", { length: 66 }).notNull(),
    amountPaid: decimal("amount_paid", { precision: 18, scale: 8 }).notNull(),
    settlementMs: integer("settlement_ms"),
    unlockedAt: timestamp("unlocked_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    // a fan can only unlock a given region once
    uniqueIndex("region_unlocks_fan_region_uniq").on(t.fanId, t.postRegionId),
    index("region_unlocks_fan_idx").on(t.fanId),
  ],
);

// ── loyalty_ledger ───────────────────────────────────────────────────────────
export const loyaltyLedger = pgTable(
  "loyalty_ledger",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Points (not USD). 1 unlock = POINTS_PER_UNLOCK points.
    amount: decimal("amount", { precision: 18, scale: 0 }).notNull(),
    eventType: loyaltyEventTypeEnum("event_type").notNull(),
    referenceId: uuid("reference_id"), // unlock.id
    txHash: varchar("tx_hash", { length: 66 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("loyalty_user_idx").on(t.userId)],
);

// ── threads (DM conversations) ────────────────────────────────────────────────
// A conversation is always fan ↔ creator. One row per pair; `lastMessageAt`
// drives the inbox ordering. See lib/db/messages.ts.
export const threads = pgTable(
  "threads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fanId: uuid("fan_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    // one conversation per (creator, fan) pair
    uniqueIndex("threads_pair_uniq").on(t.creatorId, t.fanId),
    index("threads_creator_idx").on(t.creatorId),
    index("threads_fan_idx").on(t.fanId),
  ],
);

// ── messages ──────────────────────────────────────────────────────────────────
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    senderId: uuid("sender_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: messageKindEnum("kind").notNull().default("text"),
    // Text body, or the caption shown above a PPV card.
    body: text("body"),
    // PPV only — the locked post the recipient unlocks via the normal flow.
    postId: uuid("post_id").references(() => posts.id, { onDelete: "set null" }),
    // Set when the *recipient* has read it (sender's own message is never unread).
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("messages_thread_idx").on(t.threadId, t.createdAt)],
);

// ── blur_jobs (auto-blur pipeline) ────────────────────────────────────────────
// One row per asset moving through the detect → (track) → composite → review
// state machine. Mirrors auto-blur/IMPLEMENTATION.md §4. Reuses the existing
// `media_type` enum rather than defining a duplicate.
export const blurStatusEnum = pgEnum("blur_status", [
  "uploaded",
  "detecting",
  "tracking",
  "compositing",
  "ready_for_review",
  "approved",
  "published",
  "failed",
  "manual_review",
]);

// Shared shape for a detected region (used for the review overlay).
export type DetectedRegion = {
  label: string;
  box: [number, number, number, number]; // [x1, y1, x2, y2]
  confidence: number;
  frame?: number; // video only
};

// A per-region clean crop produced during tracking, consumed by publishJob when
// the creator picks "partial". `rect` is the crop's normalized 0..1 position in
// the source frame and MUST match the crop exactly so overlays align.
export type RegionPatch = {
  label: string;
  rect: RegionRect;
  patchKey: string; // private pathname of the cropped clean clip
};

export const blurJobs = pgTable(
  "blur_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    postId: uuid("post_id").references(() => posts.id, { onDelete: "set null" }),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    mediaType: mediaTypeEnum("media_type").notNull(),
    status: blurStatusEnum("status").notNull().default("uploaded"),

    rawBlobKey: text("raw_blob_key").notNull(), // private — the upload
    blurredBlobUrl: text("blurred_blob_url"), // public — set on success
    originalBlobKey: text("original_blob_key"), // private — set on success

    // Draft post metadata captured at upload; publishJob() uses these at approve
    // (the approve request may still override them). See app/api/posts/route.ts.
    draftTitle: text("draft_title"),
    draftPrice: decimal("draft_price", { precision: 18, scale: 8 }),

    // One Replicate prediction id per stage, e.g. { detect, track, composite }.
    predictionIds: jsonb("prediction_ids")
      .$type<Record<string, string>>()
      .default({}),
    detectionConfidence: numeric("detection_confidence"), // drives fail-closed routing
    regions: jsonb("regions").$type<DetectedRegion[]>().default([]),
    // Per-region clean crops for optional partial-reveal publishing (video only).
    regionPatches: jsonb("region_patches").$type<RegionPatch[]>().default([]),
    sourceFps: integer("source_fps"), // video only — so the mask track matches

    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("blur_jobs_creator_idx").on(t.creatorId),
    index("blur_jobs_status_idx").on(t.status),
  ],
);

// Idempotency ledger for Replicate webhook events — a retried/duplicate event
// (same `event.id`) must never advance the state machine twice (PRD §12.6).
export const blurWebhookEvents = pgTable("blur_webhook_events", {
  id: text("id").primaryKey(), // Replicate/svix event id
  jobId: uuid("job_id"),
  processedAt: timestamp("processed_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// Per-stage cost/observability log — record Replicate's reported predict_time
// on every completed stage so spend is observed, not estimated (PRD §14).
export const blurCostLog = pgTable(
  "blur_cost_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jobId: uuid("job_id"),
    stage: text("stage").notNull(),
    predictTime: numeric("predict_time"), // seconds of GPU/CPU, from event.metrics
    status: text("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("blur_cost_job_idx").on(t.jobId)],
);

// ── user_balances ────────────────────────────────────────────────────────────
export const userBalances = pgTable("user_balances", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  availableBalance: decimal("available_balance", {
    precision: 18,
    scale: 8,
  })
    .default("0")
    .notNull(),
  escrowedBalance: decimal("escrowed_balance", { precision: 18, scale: 8 })
    .default("0")
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ── custodial_ledger ────────────────────────────────────────────────────────
export const custodialLedger = pgTable(
  "custodial_ledger",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    eventType: custodialLedgerTypeEnum("event_type").notNull(),
    amount: decimal("amount", { precision: 18, scale: 8 }).notNull(),
    balanceAfter: decimal("balance_after", {
      precision: 18,
      scale: 8,
    }).notNull(),
    postId: uuid("post_id").references(() => posts.id, { onDelete: "set null" }),
    reference: varchar("reference", { length: 255 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("custodial_ledger_user_idx").on(t.userId, t.createdAt),
    uniqueIndex("custodial_ledger_reference_idx").on(t.reference),
  ],
);

// ── payment_deposits ────────────────────────────────────────────────────────
export const paymentDeposits = pgTable(
  "payment_deposits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 32 }).default("stripe").notNull(),
    providerSessionId: varchar("provider_session_id", { length: 255 })
      .unique()
      .notNull(),
    providerPaymentIntentId: varchar("provider_payment_intent_id", {
      length: 255,
    }),
    providerTransactionId: varchar("provider_transaction_id", { length: 255 }),
    providerCustomerId: varchar("provider_customer_id", { length: 255 }),
    providerPaymentMethodId: varchar("provider_payment_method_id", {
      length: 255,
    }),
    status: paymentDepositStatusEnum("status").default("pending").notNull(),
    amount: decimal("amount", { precision: 18, scale: 8 }).notNull(),
    currency: varchar("currency", { length: 3 }).default("usd").notNull(),
    destinationWalletAddress: varchar("destination_wallet_address", {
      length: 42,
    }),
    tempoFundingTxHash: varchar("tempo_funding_tx_hash", { length: 66 }),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    creditedAt: timestamp("credited_at", { withTimezone: true }),
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    chargebackAt: timestamp("chargeback_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("payment_deposits_user_idx").on(t.userId, t.createdAt),
    uniqueIndex("payment_deposits_provider_session_idx").on(t.providerSessionId),
    uniqueIndex("payment_deposits_provider_tx_idx").on(t.providerTransactionId),
  ],
);

// ── platform_signing_keys ───────────────────────────────────────────────────
export const platformSigningKeys = pgTable(
  "platform_signing_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    keyId: varchar("key_id", { length: 64 }).unique().notNull(),
    address: varchar("address", { length: 42 }).notNull(),
    encryptedPrivateKey: text("encrypted_private_key").notNull(),
    iv: varchar("iv", { length: 32 }).notNull(),
    authTag: varchar("auth_tag", { length: 32 }).notNull(),
    status: platformKeyStatusEnum("status").default("active").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("platform_signing_keys_key_id_idx").on(t.keyId),
    index("platform_signing_keys_status_idx").on(t.status),
  ],
);

// ── custodial_wallets ────────────────────────────────────────────────────────
export const custodialWallets = pgTable(
  "custodial_wallets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    address: varchar("address", { length: 42 }).unique().notNull(),
    encryptedPrivateKey: text("encrypted_private_key").notNull(),
    iv: varchar("iv", { length: 32 }).notNull(),
    authTag: varchar("auth_tag", { length: 32 }).notNull(),
    status: custodialWalletStatusEnum("status").default("active").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("custodial_wallets_user_idx").on(t.userId),
    uniqueIndex("custodial_wallets_address_idx").on(t.address),
    index("custodial_wallets_status_idx").on(t.status),
  ],
);

// ── post_likes ────────────────────────────────────────────────────────────────
// One row per (post, user) like. Counts are derived, not denormalized.
export const postLikes = pgTable(
  "post_likes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("post_likes_post_user_uniq").on(t.postId, t.userId),
    index("post_likes_post_idx").on(t.postId),
  ],
);

// ── post_saves (bookmarks) ────────────────────────────────────────────────────
export const postSaves = pgTable(
  "post_saves",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("post_saves_post_user_uniq").on(t.postId, t.userId),
    index("post_saves_user_idx").on(t.userId),
  ],
);

// ── comments ──────────────────────────────────────────────────────────────────
// Single-level threading: a reply carries `parentId` pointing at the top-level
// comment it answers. `isPinned` surfaces a creator-pinned comment first.
export const comments = pgTable(
  "comments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id"), // self-ref; null for top-level comments
    body: text("body").notNull(),
    isPinned: boolean("is_pinned").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("comments_post_idx").on(t.postId, t.createdAt),
    index("comments_parent_idx").on(t.parentId),
  ],
);

// ── comment_likes ─────────────────────────────────────────────────────────────
export const commentLikes = pgTable(
  "comment_likes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    commentId: uuid("comment_id")
      .notNull()
      .references(() => comments.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("comment_likes_comment_user_uniq").on(t.commentId, t.userId),
    index("comment_likes_comment_idx").on(t.commentId),
  ],
);

// ── follows ───────────────────────────────────────────────────────────────────
// `followerId` follows `followingId`. A fan's "Following" count and a creator's
// "Fans" count both derive from this table.
export const follows = pgTable(
  "follows",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    followerId: uuid("follower_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    followingId: uuid("following_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("follows_pair_uniq").on(t.followerId, t.followingId),
    index("follows_following_idx").on(t.followingId),
  ],
);

// ── tips ──────────────────────────────────────────────────────────────────────
// A direct fan → creator payment outside the unlock flow. Settled against the
// custodial balance ledger (tip_debit / tip_credit). `postId` is the post the
// tip was sent from, when applicable.
export const tips = pgTable(
  "tips",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    fanId: uuid("fan_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    postId: uuid("post_id").references(() => posts.id, { onDelete: "set null" }),
    amount: decimal("amount", { precision: 18, scale: 8 }).notNull(),
    message: text("message"),
    paymentTxHash: varchar("payment_tx_hash", { length: 66 }).notNull(),
    settlementMs: integer("settlement_ms"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("tips_creator_idx").on(t.creatorId, t.createdAt),
    index("tips_fan_idx").on(t.fanId),
  ],
);

// ── Relations ────────────────────────────────────────────────────────────────
export const usersRelations = relations(users, ({ one, many }) => ({
  posts: many(posts),
  unlocks: many(unlocks),
  loyaltyEntries: many(loyaltyLedger),
  blurJobs: many(blurJobs),
  sentMessages: many(messages),
  custodialLedgerEntries: many(custodialLedger),
  paymentDeposits: many(paymentDeposits),
  custodialWallet: one(custodialWallets, {
    fields: [users.id],
    references: [custodialWallets.userId],
  }),
}));

export const postsRelations = relations(posts, ({ one, many }) => ({
  creator: one(users, { fields: [posts.creatorId], references: [users.id] }),
  unlocks: many(unlocks),
  blurJobs: many(blurJobs),
  regions: many(postRegions),
}));

export const postRegionsRelations = relations(postRegions, ({ one, many }) => ({
  post: one(posts, { fields: [postRegions.postId], references: [posts.id] }),
  unlocks: many(regionUnlocks),
}));

export const regionUnlocksRelations = relations(regionUnlocks, ({ one }) => ({
  fan: one(users, { fields: [regionUnlocks.fanId], references: [users.id] }),
  region: one(postRegions, {
    fields: [regionUnlocks.postRegionId],
    references: [postRegions.id],
  }),
}));

export const threadsRelations = relations(threads, ({ one, many }) => ({
  creator: one(users, { fields: [threads.creatorId], references: [users.id] }),
  fan: one(users, { fields: [threads.fanId], references: [users.id] }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  thread: one(threads, { fields: [messages.threadId], references: [threads.id] }),
  sender: one(users, { fields: [messages.senderId], references: [users.id] }),
  post: one(posts, { fields: [messages.postId], references: [posts.id] }),
}));

export const blurJobsRelations = relations(blurJobs, ({ one }) => ({
  creator: one(users, { fields: [blurJobs.creatorId], references: [users.id] }),
  post: one(posts, { fields: [blurJobs.postId], references: [posts.id] }),
}));

export const unlocksRelations = relations(unlocks, ({ one }) => ({
  fan: one(users, { fields: [unlocks.fanId], references: [users.id] }),
  post: one(posts, { fields: [unlocks.postId], references: [posts.id] }),
}));

export const loyaltyLedgerRelations = relations(loyaltyLedger, ({ one }) => ({
  user: one(users, { fields: [loyaltyLedger.userId], references: [users.id] }),
}));

export const userBalancesRelations = relations(userBalances, ({ one }) => ({
  user: one(users, { fields: [userBalances.userId], references: [users.id] }),
}));

export const custodialLedgerRelations = relations(custodialLedger, ({ one }) => ({
  user: one(users, { fields: [custodialLedger.userId], references: [users.id] }),
  post: one(posts, { fields: [custodialLedger.postId], references: [posts.id] }),
}));

export const paymentDepositsRelations = relations(paymentDeposits, ({ one }) => ({
  user: one(users, { fields: [paymentDeposits.userId], references: [users.id] }),
}));

export const custodialWalletsRelations = relations(custodialWallets, ({ one }) => ({
  user: one(users, { fields: [custodialWallets.userId], references: [users.id] }),
}));

export const commentsRelations = relations(comments, ({ one, many }) => ({
  post: one(posts, { fields: [comments.postId], references: [posts.id] }),
  author: one(users, { fields: [comments.userId], references: [users.id] }),
  parent: one(comments, {
    fields: [comments.parentId],
    references: [comments.id],
    relationName: "comment_replies",
  }),
  replies: many(comments, { relationName: "comment_replies" }),
  likes: many(commentLikes),
}));

export const commentLikesRelations = relations(commentLikes, ({ one }) => ({
  comment: one(comments, {
    fields: [commentLikes.commentId],
    references: [comments.id],
  }),
  user: one(users, { fields: [commentLikes.userId], references: [users.id] }),
}));

export const tipsRelations = relations(tips, ({ one }) => ({
  fan: one(users, { fields: [tips.fanId], references: [users.id] }),
  creator: one(users, { fields: [tips.creatorId], references: [users.id] }),
  post: one(posts, { fields: [tips.postId], references: [posts.id] }),
}));

export const followsRelations = relations(follows, ({ one }) => ({
  follower: one(users, { fields: [follows.followerId], references: [users.id] }),
  following: one(users, {
    fields: [follows.followingId],
    references: [users.id],
  }),
}));
