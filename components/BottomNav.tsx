"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Home, Bell, Plus, MessageCircle } from "lucide-react";
import { useAppAuth } from "./useAppAuth";
import { feedQueryKey, fetchFeed } from "@/lib/feed-client";
import { fetchMessages, messagesQueryKey } from "@/lib/messages-client";
import {
  fetchNotifications,
  notificationsQueryKey,
} from "@/lib/notifications-client";

// The settings drawer (with its passkey/theme logic) only matters once the fan
// taps Profile — defer its chunk until then instead of shipping it with the nav.
const SettingsDrawer = dynamic(() =>
  import("./SettingsDrawer").then((m) => m.SettingsDrawer),
);

export function BottomNav() {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { isSignedIn } = useAppAuth();
  const [unread, setUnread] = useState(0);
  const [drawer, setDrawer] = useState(false);
  // Stays true after the first open so the close animation still runs.
  const [drawerMounted, setDrawerMounted] = useState(false);

  // Real unread-message badge. It reads through the shared inbox cache, so the
  // badge, Messages screen, and tab prefetch all dedupe the same request.
  useEffect(() => {
    if (!isSignedIn) {
      setUnread(0);
      return;
    }
    void queryClient
      .fetchQuery({
        queryKey: messagesQueryKey,
        queryFn: fetchMessages,
        staleTime: 30_000,
      })
      .then((d) => {
        const total = d.threads.reduce((n, t) => n + (t.unread ?? 0), 0);
        setUnread(total);
      })
      .catch(() => {});
  }, [isSignedIn, pathname, queryClient]);

  // Keep the other main tabs warm while the user is elsewhere. Then taps can
  // reuse cached rows instead of showing a fresh loading pass.
  useEffect(() => {
    if (!isSignedIn) return;
    const prefetch = () => {
      if (pathname !== "/") {
        void queryClient.prefetchQuery({
          queryKey: feedQueryKey,
          queryFn: fetchFeed,
          staleTime: 60_000,
        });
      }
      if (!pathname.startsWith("/messages")) {
        void queryClient.prefetchQuery({
          queryKey: messagesQueryKey,
          queryFn: fetchMessages,
          staleTime: 30_000,
        });
      }
      if (!pathname.startsWith("/notifications")) {
        void queryClient.prefetchQuery({
          queryKey: notificationsQueryKey,
          queryFn: fetchNotifications,
          staleTime: 30_000,
        });
      }
    };
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(prefetch, { timeout: 1500 });
      return () => window.cancelIdleCallback(id);
    }
    const id = globalThis.setTimeout(prefetch, 300);
    return () => globalThis.clearTimeout(id);
  }, [isSignedIn, pathname, queryClient]);

  const TABS = [
    { href: "/", label: "Feed", icon: Home },
    { href: "/notifications", label: "Notifications", icon: Bell },
    {
      href: "/messages",
      label: "Messages",
      icon: MessageCircle,
      badge: unread > 0 ? String(unread) : undefined,
    },
  ] as const;

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  const tabIndex = (path: string) => {
    if (path.startsWith("/notifications")) return 1;
    if (path.startsWith("/messages")) return 2;
    return 0;
  };

  const transitionFor = (href: string) =>
    tabIndex(href) >= tabIndex(pathname) ? ["nav-forward"] : ["nav-back"];

  return (
    <>
      <nav
        className="bg-surface border-hairline-strong fixed inset-x-0 bottom-0 z-30 border-t backdrop-blur-xl"
        style={{
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 14px)",
          boxShadow: "var(--shadow-nav)",
        }}
      >
        <div className="mx-auto flex w-full max-w-md items-center justify-around px-4 pt-2">
          <NavTab
            {...TABS[0]}
            active={isActive(TABS[0].href)}
            transitionTypes={transitionFor(TABS[0].href)}
          />
          <NavTab
            {...TABS[1]}
            active={isActive(TABS[1].href)}
            transitionTypes={transitionFor(TABS[1].href)}
          />

          {/* Center: New post */}
          <Link
            href="/new"
            transitionTypes={["nav-forward"]}
            aria-label="New post"
            className="bg-primary text-primary-fg flex h-[42px] w-[50px] items-center justify-center rounded-[14px]"
            style={{ boxShadow: "0 6px 20px var(--primary-glow)" }}
          >
            <Plus size={24} strokeWidth={2.3} />
          </Link>

          <NavTab
            {...TABS[2]}
            active={isActive(TABS[2].href)}
            transitionTypes={transitionFor(TABS[2].href)}
          />

          {/* Profile - opens the settings drawer instead of navigating. */}
          <button
            type="button"
            onClick={() => {
              setDrawerMounted(true);
              setDrawer(true);
            }}
            aria-label="Profile"
            className="flex size-12 items-center justify-center"
          >
            <span
              className="size-[30px] rounded-full"
              style={{
                background: "conic-gradient(from 120deg,#3a3640,#1c1a22)",
                boxShadow: `0 0 0 2px ${
                  drawer || isActive("/profile") ? "var(--primary)" : "transparent"
                }`,
              }}
            />
          </button>
        </div>
      </nav>

      {/* Rendered as a sibling of <nav> so the drawer's z-50 isn't trapped
          inside the nav's z-30 stacking context (it would otherwise paint
          beneath page headers like the feed's sticky z-40 bar). */}
      {drawerMounted && (
        <SettingsDrawer open={drawer} onClose={() => setDrawer(false)} />
      )}
    </>
  );
}

function NavTab({
  href,
  label,
  icon: Icon,
  badge,
  active,
  transitionTypes,
}: {
  href: string;
  label: string;
  icon: typeof Home;
  badge?: string;
  active: boolean;
  transitionTypes: string[];
}) {
  return (
    <Link
      href={href}
      transitionTypes={transitionTypes}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className="relative flex size-12 items-center justify-center transition-colors"
      style={{ color: active ? "var(--primary)" : "var(--faint)" }}
    >
      <Icon size={25} strokeWidth={1.9} />
      {badge && (
        <span
          className="bg-primary text-primary-fg tabular absolute top-1 right-1 flex h-[17px] min-w-[17px] items-center justify-center rounded-full px-1 text-[10px] font-bold"
        >
          {badge}
        </span>
      )}
    </Link>
  );
}
