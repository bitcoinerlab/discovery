import { spawnSync } from 'child_process';
import { join } from 'path';

test.each([
  "require('node:net').connect(443, 'example.com')",
  "require('node:net').connect({ port: 443, host: '203.0.113.1' })",
  "fetch('https://example.com').catch(error => { console.error(error.cause?.message); process.exitCode = 1; })"
])('local test guard rejects public connections: %s', code => {
  const result = spawnSync(
    process.execPath,
    ['--require', join(__dirname, 'local-network.cjs'), '-e', code],
    { encoding: 'utf8', timeout: 5000 }
  );
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Local tests cannot connect to');
});
