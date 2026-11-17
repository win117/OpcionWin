// Comprobación HTTP aislada, sin conexiones reales.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const result = spawnSync(process.execPath, ['--test', path.join(__dirname, '../tests/http.test.cjs')], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
