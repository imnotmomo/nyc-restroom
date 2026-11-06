import { readFile, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { PROJECT_ID } from './policy.mjs';

export async function productionRuntime(environment = process.env) {
  if (environment.FIRESTORE_EMULATOR_HOST || environment.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('invalid_configuration');
  const path = environment.GOOGLE_APPLICATION_CREDENTIALS;
  if (!path || !isAbsolute(path)) throw new Error('invalid_configuration');
  const info = await stat(path);
  if (!info.isFile() || ![0o600, 0o640].includes(info.mode & 0o777)) throw new Error('invalid_configuration');
  const credential = JSON.parse(await readFile(path, 'utf8'));
  if (credential.type !== 'service_account' || credential.project_id !== PROJECT_ID
      || typeof credential.private_key !== 'string' || typeof credential.client_email !== 'string') {
    throw new Error('invalid_configuration');
  }
  // Never initialize Firebase at module import, use ambient credentials, or log credential material.
  const app = initializeApp({ credential: cert(credential), projectId: PROJECT_ID }, 'account-deletion');
  return { app, auth: getAuth(app), db: getFirestore(app) };
}
