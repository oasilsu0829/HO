// Cloudflare entry point. Static files come from ./public (Workers Static Assets);
// everything under /api goes to one Durable Object that runs every room, so the
// game state and its timers live in a single place and survive restarts via storage.
import { DurableObject } from 'cloudflare:workers';
import hubModule from '../hub.js';

const { createHub } = hubModule;
const enc = new TextEncoder();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      const stub = env.CASINO.get(env.CASINO.idFromName('main'));
      return stub.fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};

export class Casino extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.list({ prefix: 'room:' });
      const rooms = {};
      for (const [, room] of stored) rooms[room.id] = room;
      // each room is its own storage key so no single value grows too large
      this.hub = createHub({
        save: (room) => { this.ctx.storage.put('room:' + room.id, room); },
        remove: (id) => { this.ctx.storage.delete('room:' + id); },
      }, rooms);
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/api/events') return this.events(url.searchParams);
    let body = {};
    if (request.method === 'POST') {
      try { body = await request.json(); } catch {}
    }
    try {
      const out = this.hub.handle(request.method, url.pathname, body);
      if (out === undefined) return Response.json({ error: 'not found' }, { status: 404 });
      return Response.json(out);
    } catch (e) {
      return Response.json({ error: e.message }, { status: 400 });
    }
  }

  // Server-Sent Events: a stream we keep writing to until the browser goes away.
  events(q) {
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    let off = null, ping = null;
    const close = () => {
      if (!off) return;
      clearInterval(ping);
      const o = off; off = null; o();
      writer.close().catch(() => {});
    };
    const write = (text) => writer.write(enc.encode(text)).catch(close);
    try {
      off = this.hub.connect(String(q.get('room') || '').toUpperCase(), q.get('token'), (data) => write(`data: ${JSON.stringify(data)}\n\n`));
    } catch (e) {
      return new Response(e.message, { status: 404 });
    }
    // a failed write is how we notice the browser left
    ping = setInterval(() => write(': ping\n\n'), 10000);
    return new Response(readable, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    });
  }
}
