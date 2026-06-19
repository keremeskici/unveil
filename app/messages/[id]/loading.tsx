import Link from "next/link";
import { ArrowLeft } from "lucide-react";

// Shown instantly on navigation while the server renders the conversation —
// turns the open into an immediate transition instead of a blank wait.
export default function DmLoading() {
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
          <span className="bg-surface-2 size-[40px] shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="bg-surface-2 h-3.5 w-28 rounded" />
            <span className="bg-surface-2 h-2.5 w-16 rounded" />
          </div>
        </div>
      </header>

      <div
        className="mx-auto flex w-full max-w-md flex-1 flex-col gap-2.5 px-3.5 py-[18px]"
        style={{ opacity: 0.6 }}
        aria-hidden
      >
        <Bubble w="60%" />
        <Bubble w="44%" me />
        <Bubble w="72%" />
        <Bubble w="38%" me />
        <Bubble w="54%" />
      </div>

      <div className="bg-surface border-hairline border-t">
        <div
          className="mx-auto flex w-full max-w-md items-center gap-2.5 px-3.5 pt-3"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)" }}
        >
          <div className="bg-surface-2 h-[42px] flex-1 rounded-pill" />
          <div className="bg-surface-2 size-[42px] shrink-0 rounded-full" />
        </div>
      </div>
    </main>
  );
}

function Bubble({ w, me }: { w: string; me?: boolean }) {
  return (
    <div className="flex" style={{ justifyContent: me ? "flex-end" : "flex-start" }}>
      <span className="bg-surface-2 h-9 rounded-[20px]" style={{ width: w }} />
    </div>
  );
}
