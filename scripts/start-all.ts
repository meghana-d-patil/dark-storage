import { spawn } from 'node:child_process';
import path from 'node:path';

console.log('Starting Dark Storage WMS all services and web client...');

const cmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const cp = spawn(cmd, ['run', 'dev'], {
  stdio: 'inherit',
  shell: true
});

cp.on('close', (code) => {
  process.exit(code || 0);
});
