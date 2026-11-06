import { randomBytes } from 'node:crypto';
import { ModerationError } from './policy.mjs';

/** Opaque, actor-bound positions only; never place private document paths in URLs. */
export class CursorStore {
  constructor({ now = () => Date.now(), capacity = 512, ttl = 15 * 60_000 } = {}) {
    this.now = now; this.capacity = capacity; this.ttl = ttl; this.entries = new Map();
  }
  read(token, actor, scope) {
    if (!token) return null;
    const item = typeof token === 'string' && /^[A-Za-z0-9_-]{32}$/u.test(token) ? this.entries.get(token) : null;
    if (!item || item.actor !== actor || item.scope !== scope || item.expires <= this.now()) {
      throw new ModerationError(410, 'cursor_expired');
    }
    return item.position;
  }
  put(actor, scope, position) {
    for (const [key, value] of this.entries) if (value.expires <= this.now()) this.entries.delete(key);
    while (this.entries.size >= this.capacity) this.entries.delete(this.entries.keys().next().value);
    const token = randomBytes(24).toString('base64url');
    this.entries.set(token, { actor, scope, position, expires: this.now() + this.ttl });
    return token;
  }
}
