// Minimal Chrome DevTools Protocol client (no dependencies).
// Node 22+ provides a global WebSocket, which is all we need.

const DEFAULT_PORT = 9222;

export async function listTargets(port = DEFAULT_PORT) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  return res.json();
}

export async function version(port = DEFAULT_PORT) {
  const res = await fetch(`http://127.0.0.1:${port}/json/version`);
  return res.json();
}

export async function newTab(url, port = DEFAULT_PORT) {
  const res = await fetch(
    `http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`,
    { method: 'PUT' }
  );
  return res.json();
}

export class Session {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
  }

  static async attach(wsUrl) {
    const s = new Session(wsUrl);
    await s.connect();
    return s;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.addEventListener('open', () => resolve());
      this.ws.addEventListener('error', (e) => reject(new Error('ws error: ' + e.message)));
      this.ws.addEventListener('message', (ev) => this._onMessage(ev.data));
      this.ws.addEventListener('close', () => {
        for (const [, { reject: rj }] of this.pending) rj(new Error('socket closed'));
        this.pending.clear();
      });
    });
  }

  _onMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message + ' ' + JSON.stringify(msg.error.data ?? '')));
      else resolve(msg.result);
      return;
    }
    if (msg.method) {
      const list = this.handlers.get(msg.method) || [];
      for (const fn of list) { try { fn(msg.params, msg.sessionId); } catch (e) { console.error(e); } }
      const any = this.handlers.get('*') || [];
      for (const fn of any) { try { fn(msg); } catch (e) { console.error(e); } }
    }
  }

  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
    return () => {
      const l = this.handlers.get(method);
      const i = l.indexOf(fn);
      if (i >= 0) l.splice(i, 1);
    };
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 60000);
    });
  }

  close() { try { this.ws.close(); } catch {} }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Wait until fn() returns truthy, or throw after timeoutMs.
export async function waitFor(fn, { timeout = 30000, interval = 500, label = 'condition' } = {}) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeout) throw new Error(`timed out waiting for ${label}`);
    await sleep(interval);
  }
}
