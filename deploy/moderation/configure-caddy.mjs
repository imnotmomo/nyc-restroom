import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const IMPORT = '\timport /etc/caddy/restroom-ready-moderation.caddy';
const BEGIN = '\t# BEGIN Restroom Ready moderation';
const END = '\t# END Restroom Ready moderation';
const BLOCK = `${BEGIN}\n${IMPORT}\n${END}\n`;

/** Add one scoped import while preserving every existing site directive byte for byte. */
export function withModerationImport(source) {
  if (typeof source !== 'string' || source.includes('\r')) throw Error('Unsupported Caddy configuration');
  const sites = [...source.matchAll(/^nyc\.imfinethanku\.me[ \t]*\{[ \t]*\n/gm)];
  if (sites.length !== 1) throw Error('Expected exactly one team-domain site');
  if (source.includes('BEGIN Restroom Ready moderation') || source.includes('END Restroom Ready moderation')) {
    if (source.split(BLOCK).length !== 2 || source.split('restroom-ready-moderation.caddy').length !== 2) throw Error('Conflicting moderation import');
    return source;
  }
  if (source.includes('restroom-ready-moderation.caddy') || source.includes('@restroomModerationAPI') || source.includes('/api/moderation/')) throw Error('Review an existing moderation route before changing it');
  const at = sites[0].index + sites[0][0].length;
  return source.slice(0, at) + BLOCK + source.slice(at);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output || resolve(input) === resolve(output)) throw Error('Provide distinct input/output Caddy paths');
  await writeFile(output, withModerationImport(await readFile(input, 'utf8')), { mode: 0o600, flag: 'wx' });
}
