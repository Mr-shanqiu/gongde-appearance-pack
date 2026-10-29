// Compatibility entry for existing repository callers. Canonical script ships with the skill.
export * from './scripts/check-pack.mjs';
import { main } from './scripts/check-pack.mjs';
import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
