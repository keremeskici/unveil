import "server-only";

import { randomBytes } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  callSessions,
  commentLikes,
  custodialLedger,
  follows,
  loyaltyLedger,
  messages,
  paymentDeposits,
  postLikes,
  postSaves,
  regionUnlocks,
  threads,
  tips,
  unlocks,
  userBalances,
  users,
} from "@/lib/db/schema";
import type { AppUser } from "@/lib/app-user";

const DEMO_RESET_EMAIL = "lordofsnakes1@gmail.com";
const DEV_CLERK_ID = "dev_default_user";
const DEMO_BALANCE = "20.00";
const CREATOR_USERNAMES = [
  "gamefilm_room",
  "sports_daily",
  "scoreboard_live",
  "clutch_report",
  "buzzer_beats",
] as const;

type Creator = {
  id: string;
  username: string | null;
  displayName: string | null;
};

type DemoResetResult =
  | { status: "skipped"; reason: "not_demo_user" | "missing_creators" }
  | { status: "reset"; threads: number; balance: string };

function isDemoResetUser(user: Pick<AppUser, "email" | "clerkId">) {
  return (
    user.email?.toLowerCase() ===
      (process.env.DEMO_RESET_EMAIL ?? DEMO_RESET_EMAIL).toLowerCase() ||
    user.clerkId === DEV_CLERK_ID
  );
}

function txHash() {
  return `0x${randomBytes(32).toString("hex")}`;
}

function creatorName(creator: Creator) {
  return creator.displayName ?? creator.username ?? "the creator";
}

function demoScript(username: string | null, name: string) {
  switch (username) {
    case "gamefilm_room":
      return [
        "Your film room is ready. I can walk through the spoiler-safe demo whenever you are.",
        "Tap call if you want to show the metered voice flow.",
      ];
    case "sports_daily":
      return [
        "I just dropped a locked result reveal for the matchday post.",
        "The free preview keeps the suspense, then the reveal lands clean.",
      ];
    case "scoreboard_live":
      return [
        "New scoreboard clip is live. The ending is hidden behind the unlock.",
        "This is the one I would show the judges first.",
      ];
    case "clutch_report":
      return [
        "Sent over a quick angle on the bracket spoiler use case.",
        "It feels much more natural than generic private content.",
      ];
    default:
      return [
        `${name} sent you a fresh demo message.`,
        "Open this thread to show the first-time unread state.",
      ];
  }
}

export async function resetDemoUserState(user: AppUser): Promise<DemoResetResult> {
  if (!isDemoResetUser(user)) return { status: "skipped", reason: "not_demo_user" };

  const db = getDb();
  const creators = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
    })
    .from(users)
    .where(inArray(users.username, [...CREATOR_USERNAMES]));

  if (creators.length === 0) {
    return { status: "skipped", reason: "missing_creators" };
  }

  const creatorIds = creators.map((creator) => creator.id);
  const now = Date.now();

  return db.transaction(async (tx) => {
    await tx.delete(unlocks).where(eq(unlocks.fanId, user.id));
    await tx.delete(regionUnlocks).where(eq(regionUnlocks.fanId, user.id));
    await tx.delete(postLikes).where(eq(postLikes.userId, user.id));
    await tx.delete(postSaves).where(eq(postSaves.userId, user.id));
    await tx.delete(commentLikes).where(eq(commentLikes.userId, user.id));
    await tx.delete(loyaltyLedger).where(eq(loyaltyLedger.userId, user.id));
    await tx.delete(custodialLedger).where(eq(custodialLedger.userId, user.id));
    await tx.delete(paymentDeposits).where(eq(paymentDeposits.userId, user.id));
    await tx.delete(tips).where(eq(tips.fanId, user.id));
    await tx.delete(callSessions).where(eq(callSessions.fanId, user.id));
    await tx.delete(follows).where(eq(follows.followerId, user.id));
    await tx
      .delete(threads)
      .where(
        and(eq(threads.fanId, user.id), inArray(threads.creatorId, creatorIds)),
      );

    const [balance] = await tx
      .insert(userBalances)
      .values({
        userId: user.id,
        availableBalance: DEMO_BALANCE,
        escrowedBalance: "0",
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userBalances.userId,
        set: {
          availableBalance: DEMO_BALANCE,
          escrowedBalance: "0",
          updatedAt: new Date(),
        },
      })
      .returning();

    await tx.insert(custodialLedger).values({
      userId: user.id,
      eventType: "deposit",
      amount: DEMO_BALANCE,
      balanceAfter: balance.availableBalance,
      reference: `demo-reset:${user.id}:${txHash()}`,
    });

    for (let i = 0; i < creators.length; i++) {
      const creator = creators[i];
      const threadTime = new Date(now - i * 9 * 60 * 1000);
      const [thread] = await tx
        .insert(threads)
        .values({
          creatorId: creator.id,
          fanId: user.id,
          lastMessageAt: threadTime,
        })
        .returning();

      const script = demoScript(creator.username, creatorName(creator));
      for (let j = 0; j < script.length; j++) {
        await tx.insert(messages).values({
          threadId: thread.id,
          senderId: creator.id,
          kind: "text",
          body: script[j],
          readAt: null,
          createdAt: new Date(threadTime.getTime() + j * 1000),
        });
      }
    }

    const followTargets = creators.filter((creator) => creator.username !== "gamefilm_room");
    for (const creator of followTargets) {
      await tx
        .insert(follows)
        .values({ followerId: user.id, followingId: creator.id })
        .onConflictDoNothing();
    }

    return {
      status: "reset" as const,
      threads: creators.length,
      balance: balance.availableBalance,
    };
  });
}
