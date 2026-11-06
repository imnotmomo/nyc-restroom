import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { PROJECT_ID } from './policy.mjs';
import { FileModeratorRoster } from './auth.mjs';

export async function deletionSafetyReady(transport = fetch) {
  try {
    const response = await transport('http://127.0.0.1:3002/health', { signal: AbortSignal.timeout(2000), redirect: 'error' });
    if (!response.ok || !/^application\/json(?:\s*;.*)?$/iu.test(response.headers.get('content-type') ?? '')) return false;
    const raw = await response.text(); if (raw.length > 1024) return false;
    const health = JSON.parse(raw);
    return health && typeof health === 'object' && !Array.isArray(health) && Object.keys(health).length === 3
      && ['status', 'policyVersion', 'minimumPolicyVersion'].every(key => Object.hasOwn(health, key))
      && health.status === 'ok' && Number.isSafeInteger(health.policyVersion) && Number.isSafeInteger(health.minimumPolicyVersion)
      && health.minimumPolicyVersion >= 5 && health.policyVersion >= health.minimumPolicyVersion;
  } catch { return false; }
}

export async function productionRuntime(env = process.env) {
  if (env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('invalid_configuration');
  const credentialPath = env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!isAbsolute(credentialPath ?? '')) throw new Error('invalid_configuration');
  const stat = await lstat(credentialPath);
  if (!stat.isFile() || stat.isSymbolicLink() || ![0o600, 0o640].includes(stat.mode & 0o777)) throw new Error('invalid_configuration');
  const credential = JSON.parse(await readFile(credentialPath, 'utf8'));
  if (credential.type !== 'service_account' || credential.project_id !== PROJECT_ID
    || typeof credential.private_key !== 'string' || typeof credential.client_email !== 'string') throw new Error('invalid_configuration');
  const roster = new FileModeratorRoster({ path: env.MODERATOR_ROSTER_PATH, bootstrapEmail: env.MODERATOR_BOOTSTRAP_EMAIL });
  const app = initializeApp({ credential: cert(credential), projectId: PROJECT_ID }, 'moderation');
  return { app, auth: getAuth(app), db: getFirestore(app), roster, safetyReady: deletionSafetyReady };
}
