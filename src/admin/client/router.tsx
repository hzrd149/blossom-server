/**
 * Minimal history router for the console. Paths are relative to /admin.
 * Query strings are part of the location so filters survive reloads and links.
 */
import {
  type AnchorHTMLAttributes,
  type MouseEvent,
  useSyncExternalStore,
} from "react";

const BASE = "/admin";
const NAVIGATE_EVENT = "admin:navigate";

function subscribe(onChange: () => void): () => void {
  addEventListener("popstate", onChange);
  addEventListener(NAVIGATE_EVENT, onChange);
  return () => {
    removeEventListener("popstate", onChange);
    removeEventListener(NAVIGATE_EVENT, onChange);
  };
}

const snapshot = () => location.pathname + location.search;

/** Full admin href for a console path, e.g. href("/blobs/x") → "/admin/blobs/x". */
export function href(path: string): string {
  return path === "/" ? BASE : `${BASE}${path}`;
}

export function navigate(
  path: string,
  options: { replace?: boolean } = {},
): void {
  const target = href(path);
  if (target === snapshot()) return;
  if (options.replace) history.replaceState(null, "", target);
  else history.pushState(null, "", target);
  dispatchEvent(new Event(NAVIGATE_EVENT));
  if (!options.replace) scrollTo(0, 0);
}

/** Current path (relative to /admin) and query parameters. */
export function useLocation(): { path: string; search: URLSearchParams } {
  const current = useSyncExternalStore(subscribe, snapshot);
  const url = new URL(current, location.origin);
  const path = url.pathname.slice(BASE.length) || "/";
  return { path, search: url.searchParams };
}

/** Update query parameters in place (replace, no scroll). Empty values are removed. */
export function setSearch(
  updates: Record<string, string | number | null | undefined>,
): void {
  const url = new URL(location.href);
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === undefined || value === "") {
      url.searchParams.delete(key);
    } else url.searchParams.set(key, String(value));
  }
  history.replaceState(null, "", url.pathname + url.search);
  dispatchEvent(new Event(NAVIGATE_EVENT));
}

export function Link(
  { to, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    to: string;
  },
) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (
      event.defaultPrevented || event.button !== 0 || event.metaKey ||
      event.ctrlKey || event.shiftKey || event.altKey
    ) {
      return;
    }
    event.preventDefault();
    navigate(to);
  };
  return <a href={href(to)} onClick={handleClick} {...props} />;
}
