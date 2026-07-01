"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { usePrivy } from "@privy-io/react-auth";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useState, type ReactNode } from "react";
import { ACTIVE_CHAIN } from "@/lib/chain";
import { RubiconError } from "@/lib/rubicon/client";

const PrivyConfiguredContext = createContext(false);

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: true,
        retry: (failureCount, error) => {
          if (error instanceof RubiconError && ["auth", "validation", "not_found"].includes(error.kind)) return false;
          return failureCount < 2;
        },
      },
      mutations: { retry: false },
    },
  });
}

function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function PrivyQueryProvider({ children }: { children: ReactNode }) {
  const { user } = usePrivy();

  // A new authenticated identity gets a new cache, so creator data can never
  // bleed between account switches on the same browser.
  return <QueryProvider key={user?.id ?? "anonymous"}>{children}</QueryProvider>;
}

export function AppProviders({ children }: { children: ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const clientId = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID;

  if (!appId) {
    return (
      <PrivyConfiguredContext.Provider value={false}>
        <QueryProvider>{children}</QueryProvider>
      </PrivyConfiguredContext.Provider>
    );
  }

  return (
    <PrivyConfiguredContext.Provider value>
      <PrivyProvider
        appId={appId}
        clientId={clientId}
        config={{
          loginMethods: ["twitter", "email", "wallet"],
          appearance: {
            theme: "light",
            accentColor: "#2f7df6",
          },
          // Transactions settle on Arc — Arc Testnet for now.
          defaultChain: ACTIVE_CHAIN,
          supportedChains: [ACTIVE_CHAIN],
          embeddedWallets: {
            // Give every creator a wallet on login, including email/Twitter
            // sign-ins, so the receiving address is one click in Settings.
            ethereum: {
              createOnLogin: "all-users",
            },
          },
        }}
      >
        <PrivyQueryProvider>{children}</PrivyQueryProvider>
      </PrivyProvider>
    </PrivyConfiguredContext.Provider>
  );
}

export function usePrivyConfigured() {
  return useContext(PrivyConfiguredContext);
}
