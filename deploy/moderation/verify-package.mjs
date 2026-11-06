import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { lstat, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const RELEASE_FILES = [
  'package.json', 'package-lock.json',
  ...['auth', 'content-safety', 'cursors', 'policy', 'runtime', 'server', 'service', 'text-filter'].map(name => `src/${name}.mjs`),
  'restroom-ready-moderation.service', 'runtime.env.example', 'Caddyfile.snippet',
  'configure-caddy.mjs', 'preflight.mjs', 'verify-package.mjs', 'service-identity.mjs',
];
const sha = data => createHash('sha256').update(data).digest('hex');
const text = (buffer, offset, length) => buffer.subarray(offset, offset + length).toString('utf8').replace(/\0.*$/su, '');
const octal = value => {
  if (!/^[0-7]+$/u.test(value.trim())) throw Error('Invalid tar metadata');
  const number = Number.parseInt(value.trim(), 8);
  if (!Number.isSafeInteger(number) || number < 0) throw Error('Invalid tar size');
  return number;
};

/** Validate a bounded regular-file-only USTAR archive before any remote extraction. */
export async function verifyPackage(path) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) throw Error('Invalid release archive');
  const archive = await readFile(path), tar = gunzipSync(archive, { maxOutputLength: 8 * 1024 * 1024 });
  const entries = new Map(); let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const checksum = octal(text(header, 148, 8));
    let sum = 0; for (let index = 0; index < 512; index++) sum += index >= 148 && index < 156 ? 32 : header[index];
    if (sum !== checksum || text(header, 345, 155)) throw Error('Invalid archive header');
    const raw = text(header, 0, 100), name = raw.replace(/^\.\//u, ''), type = header[156], size = octal(text(header, 124, 12));
    if (type === 53) {
      if (!['', 'src/', './'].includes(name) || size !== 0) throw Error('Unexpected archive directory');
    } else {
      if (![0, 48].includes(type) || ![...RELEASE_FILES, 'RELEASE.json'].includes(name) || entries.has(name)) throw Error('Unexpected archive member');
      if (offset + 512 + size > tar.length) throw Error('Truncated archive');
      entries.set(name, tar.subarray(offset + 512, offset + 512 + size));
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (tar.length - offset < 1024 || !tar.subarray(offset).every(byte => byte === 0)
    || entries.size !== RELEASE_FILES.length + 1 || !entries.has('RELEASE.json')) throw Error('Incomplete release archive');
  const manifest = JSON.parse(entries.get('RELEASE.json').toString('utf8'));
  if (!/^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{12}-[a-f0-9]{12}$/u.test(manifest.release)
    || !/^[a-f0-9]{40,64}$/u.test(manifest.sourceHead) || typeof manifest.sourceDirty !== 'boolean'
    || !manifest.files || Object.keys(manifest.files).length !== RELEASE_FILES.length
    || !RELEASE_FILES.every(name => entries.has(name) && manifest.files[name] === sha(entries.get(name)))) throw Error('Release manifest mismatch');
  return { release: manifest.release, sha256: sha(archive), files: manifest.files };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (process.argv.length !== 3) throw Error('Provide a release archive');
  process.stdout.write(JSON.stringify(await verifyPackage(process.argv[2])) + '\n');
}
