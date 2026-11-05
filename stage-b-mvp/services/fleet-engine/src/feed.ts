// the live websocket feed. the gateway has already checked the token and passes on who it
// belongs to, so all this does is decide what each person may see

export type Viewer = { userId: string; role: string; exp: number };

type Message = { type: string; userId?: string; data?: { userId?: string }[] };

// visible to anyone with a valid token
const PUBLIC = new Set(['INFO', 'PRICE_EVENT']);
// each carries the customer it belongs to
const PERSONAL = new Set(['SCAN_EVENT', 'CHECKOUT_EVENT', 'RECOMMENDATION_EVENT']);

export function viewFor(viewer: Viewer, message: Message): unknown {
  if (viewer.role === 'admin') return message;
  if (PUBLIC.has(message.type)) return message;
  if (PERSONAL.has(message.type)) return message.userId === viewer.userId ? message : null;
  if (message.type === 'TROLLEY_POSITIONS') {
    return { ...message, data: (message.data ?? []).filter((t) => t.userId === viewer.userId) };
  }
  // a new event type stays private until someone decides who should see it
  return null;
}

export function viewerFromHeaders(headers: Record<string, string | string[] | undefined>): Viewer | null {
  const { 'x-user-id': userId, 'x-user-role': role, 'x-token-exp': exp } = headers;
  if (typeof userId !== 'string' || typeof role !== 'string' || typeof exp !== 'string' || !userId) return null;
  const expires = Number(exp);
  return Number.isFinite(expires) ? { userId, role, exp: expires } : null;
}

type SocketLike = {
  readyState: number;
  send(text: string): void;
  close(code: number, reason: string): void;
  on(event: 'close' | 'error', handler: () => void): unknown;
};

const OPEN = 1;
export const TOKEN_EXPIRED = 4401;

type Options = { now?: () => number; setTimer?: (fn: () => void, ms: number) => void };

export class Feed {
  private readonly clients = new Map<SocketLike, Viewer>();
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => void;

  constructor(options: Options = {}) {
    this.now = options.now ?? Date.now;
    this.setTimer = options.setTimer ?? ((fn, ms) => void setTimeout(fn, ms).unref());
  }

  size() {
    return this.clients.size;
  }

  add(socket: SocketLike, viewer: Viewer) {
    const remaining = viewer.exp * 1000 - this.now();
    if (remaining <= 0) {
      socket.close(TOKEN_EXPIRED, 'token expired');
      return;
    }
    this.clients.set(socket, viewer);
    const forget = () => this.clients.delete(socket);
    socket.on('close', forget);
    socket.on('error', forget);
    // a token check at connect time only proves it was valid then. the client reconnects
    // with a fresh token, or ends up back at the login screen
    this.setTimer(() => {
      forget();
      socket.close(TOKEN_EXPIRED, 'token expired');
    }, remaining);
    socket.send(JSON.stringify({ type: 'INFO', message: 'connected to ASE fleet engine' }));
  }

  broadcast(message: Message) {
    for (const [socket, viewer] of this.clients) {
      if (socket.readyState !== OPEN) continue;
      const view = viewFor(viewer, message);
      if (view !== null) socket.send(JSON.stringify(view));
    }
  }
}
