// stage A talks straight to the simulator with no login. stage B is served behind the gateway,
// so everything is same-origin and needs a token. both are fixed when the dashboard is built
export const REQUIRE_LOGIN = process.env.NEXT_PUBLIC_REQUIRE_LOGIN === '1';
export const STAGE_LABEL = REQUIRE_LOGIN ? 'Stage B' : 'Stage A';

// override with NEXT_PUBLIC_SIM_URL, e.g. when the dashboard is opened from another machine
export const SIM_HTTP = process.env.NEXT_PUBLIC_SIM_URL ?? (REQUIRE_LOGIN ? '' : 'http://localhost:3001');

export function feedUrl(token: string | null): string {
  const base = (SIM_HTTP || window.location.origin).replace(/^http/, 'ws');
  // browsers can't set headers on a websocket, so the token goes in the url
  return REQUIRE_LOGIN ? `${base}/ws?token=${encodeURIComponent(token ?? '')}` : base;
}
