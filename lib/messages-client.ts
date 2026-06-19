export type Thread = {
  id: string;
  name: string;
  avatar: string | null;
  preview: string;
  at: string;
  unread: number;
};

export type MessagesResponse = {
  threads: Thread[];
};

export const messagesQueryKey = ["messages"] as const;

export async function fetchMessages(): Promise<MessagesResponse> {
  const res = await fetch("/api/messages", { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load messages");
  return (await res.json()) as MessagesResponse;
}
