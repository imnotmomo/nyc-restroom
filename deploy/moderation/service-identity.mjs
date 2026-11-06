import { execFileSync } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function assertServiceIdentity(actual, expected) {
  if (actual.active !== 'active' || !Number.isSafeInteger(actual.pid) || actual.pid <= 1
    || actual.cwd !== expected.release || actual.exe !== expected.node || actual.entry !== expected.entry) throw Error('Moderator service identity did not match the release');
  const lines = actual.listeners.trim().split('\n');
  if (lines.length !== 1 || lines[0].trim().split(/\s+/u)[3] !== '127.0.0.1:3003') throw Error('Unexpected moderator listener');
  const owners = [...lines[0].matchAll(/\bpid=(\d+),/gu)].map(match => Number(match[1]));
  if (owners.length !== 1 || owners[0] !== actual.pid) throw Error('Moderator port is not owned by its systemd MainPID');
}

/** Linux VPS-only process ownership check; no requests, user data or credentials. */
export async function checkRunningRelease(release) {
  if (!/^\/srv\/restroom-ready-moderation\/releases\/[A-Za-z0-9-]+$/u.test(release)) throw Error('Invalid release path');
  const run = (program, args) => execFileSync(program, args, { encoding: 'utf8', maxBuffer: 65536 }).trim();
  const unit = 'restroom-ready-moderation.service';
  const active = run('systemctl', ['is-active', unit]);
  const rawPID = run('systemctl', ['show', '--property=MainPID', '--value', unit]);
  if (!/^\d+$/u.test(rawPID)) throw Error('Invalid service MainPID');
  const pid = Number(rawPID);
  if (!Number.isSafeInteger(pid) || pid <= 1) throw Error('Missing service MainPID');
  const args = (await readFile(`/proc/${pid}/cmdline`)).toString('utf8').split('\0').filter(Boolean);
  if (args.length !== 2) throw Error('Unexpected moderator process arguments');
  const [cwd, exe, entry, node] = await Promise.all([
    realpath(`/proc/${pid}/cwd`), realpath(`/proc/${pid}/exe`), realpath(args[1]), realpath('/opt/node/bin/node'),
  ]);
  assertServiceIdentity({ active, pid, cwd, exe, entry, listeners: run('ss', ['-H', '-ltnp', 'sport = :3003']) },
    { release, node, entry: resolve(release, 'src/server.mjs') });
  if (run('systemctl', ['is-active', unit]) !== 'active'
    || run('systemctl', ['show', '--property=MainPID', '--value', unit]) !== rawPID) throw Error('Moderator process changed during verification');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (process.argv.length !== 3) throw Error('Provide the expected release directory');
  await checkRunningRelease(process.argv[2]);
}
