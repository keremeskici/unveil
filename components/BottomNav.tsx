"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Bell, Plus, MessageCircle } from "lucide-react";
import { SettingsDrawer } from "./SettingsDrawer";
import { useAppAuth } from "./useAppAuth";

export function BottomNav() {
  const pathname = usePathname();
  const { isSignedIn } = useAppAuth();
  const [unread, setUnread] = useState(0);
  const [drawer, setDrawer] = useState(false);

  // Real unread-message badge. Refetched on navigation (cheap) so opening a
  // thread — which marks it read — clears the badge when you come back.
  useEffect(() => {
    if (!isSignedIn) {
      setUnread(0);
      return;
    }
    let live = true;
    fetch("/api/messages")
      .then((r) => r.json())
      .then((d) => {
        if (!live) return;
        const total = (d.threads ?? []).reduce(
          (n: number, t: { unread: number }) => n + (t.unread ?? 0),
          0,
        );
        setUnread(total);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [isSignedIn, pathname]);

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
          boxShadow: "0 -12px 32px rgba(0,0,0,.34)",
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
            onClick={() => setDrawer(true)}
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
      <SettingsDrawer open={drawer} onClose={() => setDrawer(false)} />
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
