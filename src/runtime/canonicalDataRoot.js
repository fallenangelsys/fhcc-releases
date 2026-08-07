import 'dotenv/config';
import path from 'node:path';
import process from 'node:process';

// Every launch path (installed Electron supervisor, PM2 and direct Node) must
// resolve the same stores. An explicitly supplied path still wins for tests,
// staging migrations and portable deployments.
if (!String(process.env.FALLEN_HEAVEN_DATA_DIR || '').trim()) {
  const explicitRuntimeRoot = String(process.env.FALLEN_HEAVEN_RUNTIME_DIR || '').trim();
  if (explicitRuntimeRoot) {
    process.env.FALLEN_HEAVEN_RUNTIME_DIR = path.resolve(explicitRuntimeRoot);
    process.env.FALLEN_HEAVEN_DATA_DIR = path.join(process.env.FALLEN_HEAVEN_RUNTIME_DIR, 'data');
  } else {
    const appData = String(process.env.APPDATA || '').trim();
    if (process.platform === 'win32' && appData) {
      const runtimeRoot = path.join(appData, 'FALLEN HEAVEN Control Center', 'runtime');
      process.env.FALLEN_HEAVEN_RUNTIME_DIR = runtimeRoot;
      process.env.FALLEN_HEAVEN_DATA_DIR = path.join(runtimeRoot, 'data');
    }
  }
}
