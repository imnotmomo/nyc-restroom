import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function checkPolicy(releasePath, floorPath) {
  const release = JSON.parse(await readFile(releasePath, 'utf8'));
  let floor = 1;
  try { floor = Number((await readFile(floorPath, 'utf8')).trim()); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const version = release.policyVersion ?? 1;
  if (!Number.isSafeInteger(floor) || floor < 1 || !Number.isSafeInteger(version)
      || version < floor) throw new Error('Account service policy is below the required version');
  return version;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  checkPolicy(process.argv[2], process.argv[3]).catch(() => {
    process.stderr.write('Account service policy preflight failed.\n');
    process.exitCode = 1;
  });
}
