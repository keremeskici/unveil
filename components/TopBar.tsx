"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { Wordmark } from "./Wordmark";

export function TopBar({ children }: { children?: React.ReactNode }) {
  return (
    <header
      className="pt-safe sticky top-0 z-40 border-b text-white"
      style={{
        background:
          "radial-gradient(145% 155% at 50% -72%, rgba(194,20,59,.58), rgba(194,20,59,.32) 42%, rgba(194,20,59,.12) 68%, transparent 92%), linear-gradient(180deg, #080102 0%, #010101 100%)",
        borderColor: "rgba(255,255,255,.09)",
        boxShadow: "0 8px 24px rgba(0,0,0,.32)",
      }}
    >
      <div className="mx-auto flex w-full max-w-md items-center justify-between px-[18px] py-3.5">
        <Wordmark showMark={false} />
        <div className="flex items-center gap-1.5">
          <Link
            href="/search"
            className="flex size-[42px] items-center justify-center text-white/70 hover:text-white"
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
