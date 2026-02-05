/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { startRemoteServer } from './remoteServer.js';
import { tuiRemoteBridge } from '../ui/utils/remoteBridge.js';

vi.mock('../ui/utils/remoteBridge.js', () => ({
  tuiRemoteBridge: {
    isRegistered: vi.fn(),
    submitMessage: vi.fn(),
    getCurrentHistory: vi.fn(),
  },
}));

describe('RemoteServer', () => {
  let server: http.Server;
  let port: number;

  beforeEach(() => {
    vi.clearAllMocks();
    // Use a unique port for each test to avoid conflicts
    port = Math.floor(Math.random() * 10000) + 10000;
  });

  afterEach(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  const makeRequest = (method: string, path: string, body?: unknown) => new Promise<{ statusCode: number; body: string }>(
      (resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port,
            path,
            method,
            headers: body ? { 'Content-Type': 'application/json' } : {},
          },
          (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () =>
              resolve({ statusCode: res.statusCode!, body: data }),
            );
          },
        );
        req.on('error', (err) => {
          reject(err);
        });
        if (body) {
          req.write(JSON.stringify(body));
        }
        req.end();
      },
    );

  const waitForServer = (srv: http.Server) => new Promise<void>((resolve, reject) => {
      srv.on('listening', () => resolve());
      srv.on('error', (err) => reject(err));
    });

  it('should return 503 if bridge is not registered for POST /message', async () => {
    vi.mocked(tuiRemoteBridge.isRegistered).mockReturnValue(false);
    server = startRemoteServer(port);
    await waitForServer(server);

    const response = await makeRequest('POST', '/message', {
      message: 'hello',
    });
    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.body).error).toBe(
      'TUI bridge is not yet registered',
    );
  });

  it('should submit message and return 200 for POST /message', async () => {
    vi.mocked(tuiRemoteBridge.isRegistered).mockReturnValue(true);
    server = startRemoteServer(port);
    await waitForServer(server);

    const response = await makeRequest('POST', '/message', {
      message: 'hello',
    });
    expect(response.statusCode).toBe(200);
    expect(tuiRemoteBridge.submitMessage).toHaveBeenCalledWith('hello');
  });

  it('should return 400 for POST /message with missing message', async () => {
    vi.mocked(tuiRemoteBridge.isRegistered).mockReturnValue(true);
    server = startRemoteServer(port);
    await waitForServer(server);

    const response = await makeRequest('POST', '/message', {});
    expect(response.statusCode).toBe(400);
  });

  it('should return history for GET /history', async () => {
    vi.mocked(tuiRemoteBridge.isRegistered).mockReturnValue(true);
    vi.mocked(tuiRemoteBridge.getCurrentHistory).mockReturnValue([
      { type: 'user', text: 'hello' },
      { type: 'gemini', text: 'hi' },
    ]);
    server = startRemoteServer(port);
    await waitForServer(server);

    const response = await makeRequest('GET', '/history');
    expect(response.statusCode).toBe(200);
    const history = JSON.parse(response.body);
    expect(history).toHaveLength(2);
    expect(history[0].role).toBe('user');
    expect(history[1].role).toBe('model');
  });

  it('should respect limit for GET /history', async () => {
    vi.mocked(tuiRemoteBridge.isRegistered).mockReturnValue(true);
    vi.mocked(tuiRemoteBridge.getCurrentHistory).mockReturnValue([
      { type: 'user', text: 'msg1' },
      { type: 'gemini', text: 'msg2' },
      { type: 'user', text: 'msg3' },
    ]);
    server = startRemoteServer(port);
    await waitForServer(server);

    const response = await makeRequest('GET', '/history?limit=2');
    expect(response.statusCode).toBe(200);
    const history = JSON.parse(response.body);
    expect(history).toHaveLength(2);
    expect(history[0].text).toBe('msg2');
    expect(history[1].text).toBe('msg3');
  });
});
