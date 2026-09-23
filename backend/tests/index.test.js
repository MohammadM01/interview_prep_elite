import test from 'node:test';
import { closeDatabaseConnection } from '../src/config/database.js';

await import('./auth.test.js');
await import('./kits.test.js');

test('Teardown and Exit', async () => {
  await closeDatabaseConnection();
  setTimeout(() => process.exit(0), 100);
});
