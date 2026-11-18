import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { normalizeToPubkey } from "applesauce-core/helpers";
import { Link, navigate, useLocation } from "./router.tsx";

const NAV: { to: string; label: string; match: (path: string) => boolean }[] = [
  { to: "/", label: "Dashboard", match: (p) => p === "/" },
  {
    to: "/content",
    label: "Content",
    match: (p) => p.startsWith("/content") || p.startsWith("/blobs"),
  },
  { to: "/users", label: "Users", match: (p) => p.startsWith("/users") },
  { to: "/reports", label: "Reports", match: (p) => p.startsWith("/reports") },
  {
    to: "/rules",
    label: "Storage rules",
    match: (p) => p.startsWith("/rules"),
  },
  {
    to: "/settings",
    label: "Settings",
    match: (p) => p.startsWith("/settings"),
  },
];

/** Resolve a search box entry to a console path: blob hash, pubkey/npub, or content search. */
export function resolveSearch(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const hash = value.toLowerCase().match(/[0-9a-f]{64}/)?.[0];
  if (/^[0-9a-f]{64}$/i.test(value) || (hash && /^https?:\/\//.test(value))) {
    return `/blobs/${hash}`;
  }
  if (/^(npub1|nprofile1)/.test(value)) {
    try {
      const pubkey = normalizeToPubkey(value);
      if (pubkey) return `/users/${pubkey}`;
    } catch { /* fall through to content search */ }
  }
  return `/content?q=${encodeURIComponent(value)}`;
}

function GlobalSearch() {
  const [value, setValue] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        input.current?.focus();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const target = resolveSearch(value);
    if (target) {
      navigate(target);
      setValue("");
      input.current?.blur();
    }
  };
  return (
    <form onSubmit={submit} className="w-full max-w-xl" role="search">
      <label className="input w-full">
        <span className="sr-only">Search</span>
        <input
          ref={input}
          type="search"
          placeholder="Search hash, blob URL, npub, or MIME type"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <kbd className="kbd kbd-sm">⌘K</kbd>
      </label>
    </form>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { path } = useLocation();
  const drawer = useRef<HTMLInputElement>(null);
  // Close the mobile drawer after navigating.
  useEffect(() => {
    if (drawer.current) drawer.current.checked = false;
  }, [path]);

  return (
    <div className="drawer lg:drawer-open">
      <input
        id="admin-drawer"
        type="checkbox"
        className="drawer-toggle"
        ref={drawer}
      />
      <div className="drawer-content flex min-h-screen flex-col">
        <nav className="navbar min-h-12 sticky top-0 z-20 gap-2 border-b border-base-300 bg-base-100/90 px-4 py-2 backdrop-blur">
          <label
            htmlFor="admin-drawer"
            className="btn btn-ghost btn-square lg:hidden"
            aria-label="Open menu"
          >
            ☰
          </label>
          <GlobalSearch />
        </nav>
        <main className="w-full flex-1 px-4 py-3 sm:px-6">
          {children}
        </main>
      </div>
      <div className="drawer-side z-30">
        <label
          htmlFor="admin-drawer"
          aria-label="Close menu"
          className="drawer-overlay"
        />
        <aside className="flex min-h-full w-60 flex-col border-r border-base-300 bg-base-100">
          <Link to="/" className="px-5 py-4 text-lg font-semibold">
            🌸 Blossom admin
          </Link>
          <ul className="menu w-full gap-1 px-2">
            {NAV.map((item) => (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className={item.match(path) ? "menu-active" : undefined}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}
