import { parseArgs } from 'node:util';
import { generateApiKey } from '../src/auth/api-keys.js';
import { loadConfig, loadEnvFile } from '../src/config.js';
import { openDatabase } from '../src/db/database.js';
import { ApiKeyRepository, SCOPES, type Scope } from '../src/repositories/api-key-repository.js';

const usage = `Usage: npm run create-key -- --name <label> --scopes messages:write[,admin:read]

Scopes: ${SCOPES.join(', ')}`;

const { values } = parseArgs({
  options: {
    name: { type: 'string' },
    scopes: { type: 'string' },
  },
});

const name = values.name?.trim();
const scopes = (values.scopes ?? '')
  .split(',')
  .map((scope) => scope.trim())
  .filter((scope) => scope.length > 0);
const unknown = scopes.filter((scope) => !(SCOPES as readonly string[]).includes(scope));

if (!name || scopes.length === 0 || unknown.length > 0) {
  if (unknown.length > 0) {
    console.error(`Unknown scope(s): ${unknown.join(', ')}`);
  }
  console.error(usage);
  process.exit(1);
}

loadEnvFile();
const config = loadConfig();
const db = openDatabase(config.databasePath);
const key = generateApiKey();
new ApiKeyRepository(db).insert(name, key.prefix, key.hash, scopes as Scope[]);
db.close();

console.log(`Created API key "${name}" with scopes: ${scopes.join(', ')}`);
console.log('Store it now; only its hash is kept and it cannot be shown again:');
console.log(key.plaintext);
