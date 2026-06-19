"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { PasskeyEnrollmentPrompt } from "./PasskeyEnrollmentPrompt";
import { RouteTransition } from "./RouteTransition";

export function Providers({ children }: { children: React.ReactNode }) {
  // Create QueryClient inside the component to avoid shared state across requests.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 60_000 } },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <RouteTransition>{children}</RouteTransition>
      <PasskeyEnrollmentPrompt />
    </QueryClientProvider>
  );
}
