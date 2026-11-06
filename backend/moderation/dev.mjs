// Explicit demo-only integration harness. Not included in deployment packages.
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { FileModeratorRoster } from './src/auth.mjs';
import { createModerationService } from './src/service.mjs';
import { httpServer } from './src/server.mjs';
const project = process.env.MODERATION_DEMO_PROJECT;
if (!project?.startsWith('demo-') || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185'
  || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099'
  || process.env.GOOGLE_APPLICATION_CREDENTIALS) throw Error('Demo emulator configuration required.');
const state = resolve('.firebase-agent/moderation/demo-state'); await mkdir(state, { recursive: true, mode: 0o700 });
const app = initializeApp({ projectId: project }, 'moderation-demo');
const service = createModerationService({ auth: getAuth(app), db: getFirestore(app),
  safetyReady: async () => true, // Explicit demo-only override; production verifies cleanup capability.
  roster: new FileModeratorRoster({ path: resolve(state, 'moderators.json'), bootstrapEmail: 'moderator@example.test' }) });
httpServer(service, { allowedOrigin: 'http://127.0.0.1:5100' }).listen(3003, '127.0.0.1', () => console.log('Demo moderation API: 127.0.0.1:3003 (demo project only).'));
