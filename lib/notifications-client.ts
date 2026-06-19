export type NotifType = "unlock" | "tip" | "comment" | "follow" | "post";

export type Notif = {
  id: string;
  type: NotifType;
  actor: string;
  avatar: string | null;
  action: string;
  postTitle: string;
  amount: string;
  at: string;
};

export type NotificationsResponse = {
  items: Notif[];
};

export const notificationsQueryKey = ["notifications"] as const;

export async function fetchNotifications(): Promise<NotificationsResponse> {
  const res = await fetch("/api/notifications", { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load notifications");
  return (await res.json()) as NotificationsResponse;
}
