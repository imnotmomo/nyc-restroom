import { constants } from 'node:fs';
import { open, readFile, lstat, link, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { ModerationError, requireValue, uidSafe } from './policy.mjs';

export async function authenticateModerator({ auth, db, roster }, token) {
  if (typeof token !== 'string' || token.length > 8192 || !/^[A-Za-z0-9._-]+$/u.test(token)) {
    throw new ModerationError(401, 'authentication_required');
  }
  let claims, user;
  try {
    claims = await auth.verifyIdToken(token, true);
    requireValue(uidSafe(claims.uid) && claims.firebase?.sign_in_provider === 'google.com'
      && claims.email_verified === true, 401, 'authentication_required');
    user = await auth.getUser(claims.uid);
    requireValue(user.uid === claims.uid && !user.disabled && user.emailVerified === true
      && typeof user.email === 'string' && user.providerData?.some(p => p.providerId === 'google.com'), 401, 'authentication_required');
  } catch { throw new ModerationError(401, 'authentication_required'); }
  const lock = await db.collection('accountDeletionLocks').doc(user.uid).get();
  requireValue(!lock.exists, 403, 'moderator_required');
  requireValue(await roster.allows(user), 403, 'moderator_required');
  return { uid: user.uid, email: user.email,
    displayName: typeof user.displayName === 'string' && user.displayName.length <= 120 ? user.displayName : null };
}

/** Operator-controlled file; the selected verified Google identity enrolls once. */
export class FileModeratorRoster {
  constructor({ path, bootstrapEmail }) {
    if (!isAbsolute(path ?? '') || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(bootstrapEmail ?? '')) throw new Error('invalid_configuration');
    this.path = path; this.bootstrapEmail = bootstrapEmail.toLowerCase();
  }
  async load() {
    const stat = await lstat(this.path);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new Error('invalid_configuration');
    const value = JSON.parse(await readFile(this.path, 'utf8'));
    if (value.version !== 1 || !Array.isArray(value.uids) || value.uids.length > 20 || !value.uids.every(uidSafe)) throw new Error('invalid_configuration');
    return value.uids;
  }
  async allows(user) {
    try { return (await this.load()).includes(user.uid); }
    catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      // Email alone never authorizes later accounts after the first UID is pinned.
      if (!user.emailVerified || user.email?.toLowerCase() !== this.bootstrapEmail
        || !user.providerData?.some(p => p.providerId === 'google.com' && p.email?.toLowerCase() === this.bootstrapEmail)) return false;
      let file;
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      try {
        file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
        await file.writeFile(JSON.stringify({ version: 1, uids: [user.uid] }) + '\n', 'utf8');
        await file.sync();
        await file.close(); file = null;
        // Publish a complete file atomically without overwriting a concurrent enrollment/revocation.
        try { await link(temporary, this.path); } catch (failure) { if (failure?.code !== 'EEXIST') throw failure; }
      } finally { if (file) await file.close(); await unlink(temporary).catch(() => {}); }
      return (await this.load()).includes(user.uid);
    }
  }
}
