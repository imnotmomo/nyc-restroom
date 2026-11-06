import { lstat, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Offline validation only. Never prints or transmits credential content. */
export async function validateConfiguration(credentialPath, envPath, rosterPath) {
  for (const path of [credentialPath, envPath]) {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || ![0o600, 0o640].includes(stat.mode & 0o777)) throw Error('Invalid private configuration permissions');
  }
  const credential = JSON.parse(await readFile(credentialPath, 'utf8'));
  if (credential.type !== 'service_account' || credential.project_id !== 'nye-restroom'
    || credential.client_email !== 'restroom-moderation@nye-restroom.iam.gserviceaccount.com'
    || typeof credential.private_key !== 'string' || !credential.private_key.startsWith('-----BEGIN PRIVATE KEY-----')) throw Error('Expected dedicated moderation credential');
  const values = {};
  for (const line of (await readFile(envPath, 'utf8')).split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const match = /^(MODERATOR_ROSTER_PATH|MODERATOR_BOOTSTRAP_EMAIL)=([^\s"'`$\\]+)$/.exec(line);
    if (!match || Object.hasOwn(values, match[1])) throw Error('Unexpected runtime configuration');
    values[match[1]] = match[2];
  }
  if (Object.keys(values).length !== 2 || values.MODERATOR_ROSTER_PATH !== '/var/lib/restroom-ready-moderation/moderators.json'
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.MODERATOR_BOOTSTRAP_EMAIL)) throw Error('Invalid moderation runtime configuration');
  if (rosterPath !== values.MODERATOR_ROSTER_PATH) throw Error('Unexpected roster path');
  try {
    const stat = await lstat(rosterPath);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw Error('Invalid roster permissions');
    const roster = JSON.parse(await readFile(rosterPath, 'utf8'));
    if (roster.version !== 1 || !Array.isArray(roster.uids) || roster.uids.length > 20
      || !roster.uids.every(uid => typeof uid === 'string' && uid.length > 0 && uid.length <= 128 && !/[\x00-\x1f/]/.test(uid))) throw Error('Invalid UID roster');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const paths = process.argv.slice(2);
  if (paths.length !== 3) throw Error('Provide private configuration paths');
  await validateConfiguration(...paths);
}
