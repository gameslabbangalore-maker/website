import { spawnSync } from 'node:child_process';

const files = [
  'src/calendar-sync.js',
  'src/db.js',
  'src/ics.js',
  'src/ids.js',
  'src/index.js',
];

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
  console.log(`  PASS  ${file}`);
}

console.log('\nall syntax checks passed');
