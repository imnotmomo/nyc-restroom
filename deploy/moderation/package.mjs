import { createHash } from 'node:crypto';
import { copyFile, mkdir, lstat, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export const SOURCES = new Map([
  ['backend/moderation/package.json', 'package.json'],
  ['backend/moderation/package-lock.json', 'package-lock.json'],
  ...['auth', 'content-safety', 'cursors', 'policy', 'runtime', 'server', 'service', 'text-filter'].map(name => [`backend/moderation/src/${name}.mjs`, `src/${name}.mjs`]),
  ['deploy/moderation/restroom-ready-moderation.service', 'restroom-ready-moderation.service'],
  ['deploy/moderation/runtime.env.example', 'runtime.env.example'],
  ['deploy/moderation/Caddyfile.snippet', 'Caddyfile.snippet'],
  ['deploy/moderation/configure-caddy.mjs', 'configure-caddy.mjs'],
  ['deploy/moderation/preflight.mjs', 'preflight.mjs'],
  ['deploy/moderation/verify-package.mjs', 'verify-package.mjs'],
  ['deploy/moderation/service-identity.mjs', 'service-identity.mjs'],
]);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function prepareRelease(repo, output) {
  const root = resolve(repo), destination = resolve(output), files = {};
  if (destination === root || destination.startsWith(root + '/')) throw Error('Stage outside the repository');
  await mkdir(destination, { mode: 0o700 });
  for (const [source, name] of SOURCES) {
    const path = join(root, source), stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Unsupported release input');
    await mkdir(dirname(join(destination, name)), { recursive: true, mode: 0o700 });
    await copyFile(path, join(destination, name));
    files[name] = hash(await readFile(join(destination, name)));
  }
  const sourceHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const sourceDirty = Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim());
  const sourceDigest = hash(JSON.stringify(files));
  const date = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const release = `${date}-${sourceHead.slice(0, 12)}-${sourceDigest.slice(0, 12)}`;
  await writeFile(join(destination, 'RELEASE.json'), JSON.stringify({ release, sourceHead, sourceDirty, files }, null, 2) + '\n', { mode: 0o600 });
  return release;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [repo, output] = process.argv.slice(2);
  if (!repo || !output) throw Error('Provide repository and new staging paths');
  process.stdout.write(await prepareRelease(repo, output) + '\n');
}
