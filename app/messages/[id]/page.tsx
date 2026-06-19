import { after } from "next/server";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { getCurrentAppUser } from "@/lib/app-user";
import { buildConversationView } from "@/lib/messages-view";
import { markThreadRead } from "@/lib/db/messages";
import { Conversation } from "@/components/Conversation";

// Per-user, live DB-backed conversation — always rendered dynamically. Fetching
// the thread + messages here (instead of on the client after mount) removes the
// open-time fetch waterfall and the duplicate auth round-trip.
export const dynamic = "force-dynamic";

export default async function DmPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentAppUser();

  if (!user) {
    return <DmNotice>Sign in to view this conversation.</DmNotice>;
  }

  const view = await buildConversationView(user.id, id);
  if (!view) {
    return <DmNotice>This conversation isn’t available.</DmNotice>;
  }

  // Clearing the unread badge is a side effect — run it after the response so the
  // page isn't held up by the write.
  after(() => markThreadRead(id, user.id));

  return (
    <Conversation
      threadId={id}
      initialThread={view.thread}
      initialMessages={view.messages}
    />
  );
}

function DmNotice({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-1 flex-col">
      <header className="bg-surface/80 border-hairline pt-safe sticky top-0 z-40 border-b backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-md items-center gap-3 px-4 py-3">
          <Link
            href="/messages"
            transitionTypes={["nav-back"]}
            aria-label="Back"
            className="text-text flex size-[34px] items-center justify-center"
          >
            <ArrowLeft size={22} />
          </Link>
          <span className="text-[15.5px] font-semibold">Conversation</span>
        </div>
      </header>
      <div className="mx-auto w-full max-w-md flex-1 px-4">
        <p className="text-faint mt-16 text-center text-sm">{children}</p>
      </div>
    </main>
  );
}
