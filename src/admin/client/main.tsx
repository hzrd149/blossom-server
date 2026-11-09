import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";
import { ToastProvider } from "./components/toasts.tsx";
import { QueryClientProvider } from "@tanstack/react-query";
// The admin uses production bundles locally too; keep the debugger available.
import { ReactQueryDevtools } from "@tanstack/react-query-devtools/production";
import { queryClient } from "./api/query-client.ts";
import {
  AccountsProvider,
  ActionsProvider,
  EventStoreProvider,
} from "applesauce-react/providers";
import { accounts } from "./nostr/accounts.ts";
import { actions } from "./nostr/actions.ts";
import { eventStore } from "./nostr/event-store.ts";

const root = document.getElementById("admin-root");
if (!root) throw new Error("Missing admin mount point");
createRoot(root).render(
  <QueryClientProvider client={queryClient}>
    <EventStoreProvider eventStore={eventStore}>
      <AccountsProvider manager={accounts}>
        <ActionsProvider runner={actions}>
          <ToastProvider>
            <App />
          </ToastProvider>
        </ActionsProvider>
      </AccountsProvider>
    </EventStoreProvider>
    <ReactQueryDevtools initialIsOpen={false} />
  </QueryClientProvider>,
);
