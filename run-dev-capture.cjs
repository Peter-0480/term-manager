const { spawn } = require('child_process');
const path = require('path');

// 使用 cmd.exe 避免 shell 管道语法问题
const proc = spawn('cmd.exe', ['/c', 'npx electron-vite dev -- --inspect=5858'], {
  cwd: process.cwd(),
  stdio: ['inherit', 'pipe', 'pipe'],
  env: { ...process.env }
});

let output = '';
let errorOutput = '';

proc.stdout.on('data', (chunk) => { output += chunk.toString(); errorOutput += chunk.toString(); });
proc.stderr.on('data', (chunk) => { output += chunk.toString(); errorOutput += chunk.toString(); });
proc.on('close', (code) => {
  console.log('Process exited with code:', code);
  console.log('=== CAPTURED OUTPUT ===');
  console.log(output);
});
proc.on('error', (err) => { console.error('Process error:', err); });

// 60 秒后超时强制退出
setTimeout(() => {
  proc.kill();
}, 60000);