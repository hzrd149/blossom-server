/**
 * Configures window.nostr.js. Must be imported *before* it.
 *
 * `startHidden` keeps its floating widget out of the page until a signer is
 * actually connected, because sign-in here is driven by the button in
 * IdentityBar rather than by the widget. It reappears once connected so the
 * remote signer can still be managed from it.
 *
 * `disableOverflowFix` stops it injecting `html, body { overflow: auto; height: 100% }`,
 * which turns <body> into a second scroll container on the landing page.
 */
declare global {
  var wnjParams: Record<string, unknown> | undefined;
}

globalThis.wnjParams = {
  startHidden: true,
  compactMode: true,
  disableOverflowFix: true,
  ...globalThis.wnjParams,
};
