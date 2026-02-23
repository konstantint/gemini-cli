/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestRig } from './test-helper.js';
import WebSocket from 'ws';

describe('UI Mirror Integration', () => {
  let rig: TestRig;

  beforeEach(() => {
    rig = new TestRig();
    rig.setup('ui-mirror-test');
  });

  afterEach(async () => {
    await rig.cleanup();
  });

  it('should stream UI events via WebSocket', async () => {
    const UI_PORT = Math.floor(Math.random() * 10000) + 25000;

    // 1. Start CLI with --ui-port
    const run = await rig.runInteractive({
      args: ['--ui-port', UI_PORT.toString()],
      approvalMode: 'yolo',
      env: {
        GEMINI_API_KEY: 'fake-key',
      },
    });

    // 2. Connect WebSocket with retry
    const connectWs = async (
      retries = 10,
      delay = 1000,
    ): Promise<WebSocket> => {
      for (let i = 0; i < retries; i++) {
        try {
          return await new Promise<WebSocket>((resolve, reject) => {
            const ws = new WebSocket(`ws://127.0.0.1:${UI_PORT}`);
            ws.on('open', () => resolve(ws));
            ws.on('error', (err) => {
              ws.close();
              reject(err);
            });
          });
        } catch (e) {
          if (i === retries - 1) throw e;
          await new Promise((r) => setTimeout(r, delay));
        }
      }
      throw new Error('Unreachable');
    };

    const ws = await connectWs();
    const messages: { type: string; data: Record<string, unknown> }[] = [];

    ws.on('message', (data) => {
      const messageStr = data.toString();
      // Expect null-byte termination
      if (messageStr.endsWith('\0')) {
        const jsonStr = messageStr.slice(0, -1);
        try {
          messages.push(
            JSON.parse(jsonStr) as {
              type: string;
              data: Record<string, unknown>;
            },
          );
        } catch {
          console.error('Failed to parse WebSocket message:', jsonStr);
        }
      }
    });

    // 3. Send a user message via CLI
    await run.type('echo hello world');
    await run.type('\r');

    // 4. Wait for expected events
    const waitForEvent = async (type: string, timeout = 30000) => {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if (messages.some((m) => m.type === type)) return;
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error(
        `Timed out waiting for event type: ${type}. Messages received: ${JSON.stringify(messages, null, 2)}`,
      );
    };

    await waitForEvent('user_message');

    // Verify user_message content
    const userMsg = messages.find((m) => m.type === 'user_message');
    expect(userMsg).toBeDefined();
    expect(userMsg.data.text).toContain('echo hello world');

    // Wait for idle
    await waitForEvent('idle');

    ws.close();
  });
});
