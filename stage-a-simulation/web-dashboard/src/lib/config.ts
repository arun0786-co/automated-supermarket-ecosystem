// where the stage A simulator runs. override with NEXT_PUBLIC_SIM_URL, e.g. when the
// dashboard is opened from another machine on the network
export const SIM_HTTP = process.env.NEXT_PUBLIC_SIM_URL ?? 'http://localhost:3001';
export const SIM_WS = SIM_HTTP.replace(/^http/, 'ws');
