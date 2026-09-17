/**
 * Development entry point: `npm run serve` (Node watch mode) or
 * `node src/server/serve.js`. End users start the app with `launch.mjs`.
 *
 * Environment: HOST, PORT, DATA_ROOT (settings and active circuit, default
 * `data/`), SCHEMATIC_WORKSPACE (workspace folder override).
 */

import { APP_ROOT, DEFAULT_PORT, startApp } from './app.js';
import { join, resolve } from 'node:path';

const workspace = process.env.SCHEMATIC_WORKSPACE ? resolve(process.env.SCHEMATIC_WORKSPACE) : null;

try {
  const app = await startApp({
    host: process.env.HOST || '127.0.0.1',
    port: process.env.PORT === undefined ? DEFAULT_PORT : Number(process.env.PORT),
    dataRoot: resolve(process.env.DATA_ROOT || join(APP_ROOT, 'data')),
    workspace,
  });
  console.log(`Mosfeteer running at ${app.url}`);
  console.log(`Workspace: ${app.workspace()}`);
} catch (error) {
  console.error(`Could not start Mosfeteer: ${error.message}`);
  process.exitCode = 1;
}
