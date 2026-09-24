import test from 'node:test';
import { closeDatabaseConnection } from '../src/config/database.js';

await import('./auth.test.js');
await import('./kits.test.js');
await import('./research.test.js');
await import('./generation.test.js');
await import('./step6_generation.test.js');
await import('./step7_schedule_coverage.test.js');
await import('./step8_builder.test.js');
await import('./step9_practice.test.js');

test('Teardown and Exit', async () => {
  await closeDatabaseConnection();
  setTimeout(() => process.exit(0), 100);
});
