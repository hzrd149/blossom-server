import type { ReactNode } from "react";
import { ReportsPage } from "./pages/reports.tsx";
import { ADMIN_PAGES, matchPage } from "../contracts/pages.ts";
import { Layout } from "./layout.tsx";
import { BlobPage } from "./pages/blob.tsx";
import { ContentPage } from "./pages/content.tsx";
import { DashboardPage } from "./pages/dashboard.tsx";
import { RulesPage } from "./pages/rules.tsx";
import { SettingsPage } from "./pages/settings.tsx";
import { UserPage, UsersPage } from "./pages/users.tsx";
import { EmptyState } from "./components/ui.tsx";
import { Link, useLocation } from "./router.tsx";

const ROUTES: {
  pattern: string;
  render: (params: Record<string, string>) => ReactNode;
}[] = [
  { pattern: ADMIN_PAGES.dashboard, render: () => <DashboardPage /> },
  { pattern: ADMIN_PAGES.reports, render: () => <ReportsPage /> },
  { pattern: ADMIN_PAGES.content, render: () => <ContentPage /> },
  { pattern: ADMIN_PAGES.users, render: () => <UsersPage /> },
  {
    pattern: ADMIN_PAGES.user,
    render: ({ pubkey }) => <UserPage key={pubkey} pubkey={pubkey} />,
  },
  {
    pattern: ADMIN_PAGES.blob,
    render: ({ sha256 }) => <BlobPage key={sha256} sha256={sha256} />,
  },
  { pattern: ADMIN_PAGES.rules, render: () => <RulesPage /> },
  { pattern: ADMIN_PAGES.settings, render: () => <SettingsPage /> },
];

function NotFound() {
  return (
    <EmptyState>
      Page not found. <Link to="/" className="link">Back to the dashboard</Link>
    </EmptyState>
  );
}

export function App() {
  const { path } = useLocation();
  let page: ReactNode = <NotFound />;
  for (const route of ROUTES) {
    const params = matchPage(route.pattern, path);
    if (params) {
      page = route.render(params);
      break;
    }
  }
  return <Layout>{page}</Layout>;
}
