"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { Wordmark } from "./Wordmark";

export function TopBar({ children }: { children?: React.ReactNode }) {
  return (
    <header
      className="border-hairline-strong pt-safe sticky top-0 z-40 border-b bg-[var(--header-bg)] text-[var(--header-fg)]"
      style={{ boxShadow: "var(--header-shadow)" }}
    >
      <div className="mx-auto flex w-full max-w-md items-center justify-between px-[18px] py-3.5">
        <Wordmark showMark />
        <div className="flex items-center gap-1.5">
          <Link
            href="/search"
            className="flex size-[42px] items-center justify-center text-[var(--header-fg-muted)] hover:text-[var(--header-fg)]"
            aria-label="Search"
          >
            <Search size={22} />
          </Link>
          {children}
        </div>
      </div>
    </header>
  );
}
