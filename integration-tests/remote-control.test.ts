/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, beforeEach, afterEach } from 'vitest';
import { TestRig } from './test-helper.js';
import http from 'node:http';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('remote-control', () => {
  let rig: TestRig;

  beforeEach(() => {
    rig = new TestRig();
  });

  afterEach(async () => await rig.cleanup());

  it('should allow remote control via HTTP', async () => {
    const port = Math.floor(Math.random() * 10000) + 10000;
    const fakeResponsesPath = path.join(__dirname, 'remote-control.responses');

    // Start CLI with remote port
    await rig.setup('remote-control', {
      fakeResponsesPath,
    });

    const run = await rig.runInteractive({
      env: {
        GEMINI_CLI_REMOTE_PORT: port.toString(),
        GEMINI_API_KEY: 'fake-api-key',
      },
    });

    // Wait for the CLI to be ready and the remote server to be listening
    await new Promise<void>((resolve, reject) => {
      const startTime = Date.now();
      const interval = setInterval(() => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port,
            path: '/history',
            method: 'GET',
          },
          (res) => {
            if (res.statusCode === 200) {
              clearInterval(interval);
              resolve();
            }
          },
        );
        req.on('error', () => {
          if (Date.now() - startTime > 20000) {
            clearInterval(interval);
            reject(new Error('Timed out waiting for remote server'));
          }
        });
        req.end();
      }, 1000);
    });

    // Send a message via POST /message
    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/message',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        (res) => {
          if (res.statusCode === 200) {
            resolve();
          } else {
            reject(new Error(`Failed to send message: ${res.statusCode}`));
          }
        },
      );
      req.on('error', reject);
      req.write(JSON.stringify({ message: 'echo hello-remote' }));
      req.end();
    });

    // Verify history contains the message
    await new Promise<void>((resolve, reject) => {
      const startTime = Date.now();
      const interval = setInterval(() => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port,
            path: '/history',
            method: 'GET',
          },
          (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
              try {
                const history = JSON.parse(data);
                if (
                  history.some(
                    (m: { text?: string }) =>
                      m.text && m.text.includes('echo hello-remote'),
                  )
                ) {
                  clearInterval(interval);
                  resolve();
                } else if (Date.now() - startTime > 20000) {
                  clearInterval(interval);
                  reject(new Error(`Message not found in history: ${data}`));
                }
              } catch {
                // Ignore parse errors while waiting
              }
            });
          },
        );
        req.on('error', reject);
        req.end();
      }, 1000);
    });

    // Also verify the CLI output contains the response
    await run.expectText('hello-remote');
  }, 60000); // 1 minute timeout
});
