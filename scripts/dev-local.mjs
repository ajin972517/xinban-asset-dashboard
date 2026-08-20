import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const { startCs2Proxy } = await import('./cs2-proxy.mjs');

let proxyServer;
try {
  proxyServer = await startCs2Proxy();
} catch (error) {
  console.error(`[CS2] 无法启动本地数据服务：${error?.message || error}`);
  process.exit(1);
}

const nextBin = resolve(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next');
const nextArgs = process.argv.slice(2);
const hasExplicitPort = nextArgs.some((arg) => arg === '--port' || arg === '-p' || arg.startsWith('--port='));
if (!hasExplicitPort) nextArgs.push('--port', '31888');

const nextProcess = spawn(process.execPath, [nextBin, 'dev', ...nextArgs], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
  windowsHide: true
});

const shutdown = () => {
  proxyServer?.close();
  if (!nextProcess.killed) nextProcess.kill('SIGTERM');
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
nextProcess.once('exit', (code) => {
  proxyServer?.close(() => process.exit(code ?? 0));
});
nextProcess.once('error', (error) => {
  console.error(`本地开发服务启动失败：${error?.message || error}`);
  proxyServer?.close(() => process.exit(1));
});
