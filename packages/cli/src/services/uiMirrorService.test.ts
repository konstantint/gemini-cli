/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, afterEach } from 'vitest';
import { UiMirrorService } from './uiMirrorService.js';
import { WebSocket } from 'ws';

describe('UiMirrorService', () => {
  const TEST_PORT = 12345;

  afterEach(() => {
    UiMirrorService.getInstance().stop();
  });

  it('should be a singleton', () => {
    const instance1 = UiMirrorService.getInstance();
    const instance2 = UiMirrorService.getInstance();
    expect(instance1).toBe(instance2);
  });

  it('should start a WebSocket server', async () => {
    const service = UiMirrorService.getInstance();
    await service.start(TEST_PORT);
    expect(service.isRunning()).toBe(true);
  });

  it('should broadcast messages to connected clients', async () => {
    const service = UiMirrorService.getInstance();
    await service.start(TEST_PORT);

    const client = new WebSocket(`ws://localhost:${TEST_PORT}`);

    const messagePromise = new Promise<string>((resolve) => {
      client.on('message', (data) => {
        resolve(data.toString());
      });
    });

    await new Promise<void>((resolve) => {
      client.on('open', () => resolve());
    });

    const testEvent = { type: 'test_event', data: 'hello' };
    service.broadcast(testEvent.type, testEvent.data);

    const receivedMessage = await messagePromise;
    expect(receivedMessage.endsWith('\0')).toBe(true);

    const payload = JSON.parse(receivedMessage.slice(0, -1));
    expect(payload).toEqual(testEvent);

    client.close();
  });

  it('should stop the server', async () => {
    const service = UiMirrorService.getInstance();
    await service.start(TEST_PORT);
    service.stop();
    expect(service.isRunning()).toBe(false);
  });
});
