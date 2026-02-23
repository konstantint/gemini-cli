/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { WebSocketServer, type WebSocket } from 'ws';
import {
  debugLogger,
  coreEvents,
  CoreEvent,
  type HookStartPayload,
  type HookEndPayload,
} from '@google/gemini-cli-core';

export interface UiMirrorEvent {
  type: string;
  data: unknown;
}

export class UiMirrorService {
  private static instance: UiMirrorService;
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();
  private startPromise: Promise<void> | null = null;

  private constructor() {}

  static getInstance(): UiMirrorService {
    if (!UiMirrorService.instance) {
      UiMirrorService.instance = new UiMirrorService();
    }
    return UiMirrorService.instance;
  }

  private onHookStart = (payload: HookStartPayload) => {
    this.broadcast('hook', { ...payload, type: 'hook_start' });
  };

  private onHookEnd = (payload: HookEndPayload) => {
    this.broadcast('hook', { ...payload, type: 'hook_end' });
  };

  async start(port: number): Promise<void> {
    if (this.wss) {
      const addr = this.wss.address();
      const currentPort =
        typeof addr === 'object' && addr ? addr.port : 'unknown';
      debugLogger.log(
        `UiMirrorService already running on port ${currentPort}.`,
      );
      return;
    }

    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = (async () => {
      coreEvents.on(CoreEvent.HookStart, this.onHookStart);
      coreEvents.on(CoreEvent.HookEnd, this.onHookEnd);

      return new Promise<void>((resolve, reject) => {
        try {
          debugLogger.log(`Starting UiMirrorService on port ${port}...`);
          // Using 127.0.0.1 explicitly to avoid issues in some test environments
          this.wss = new WebSocketServer({ port, host: '127.0.0.1' });

          this.wss.on('connection', (ws: WebSocket) => {
            this.clients.add(ws);

            ws.on('close', () => {
              this.clients.delete(ws);
            });

            ws.on('error', (err) => {
              debugLogger.error('UiMirrorService client error:', err);
              this.clients.delete(ws);
            });
          });

          this.wss.on('error', (err) => {
            debugLogger.error('UiMirrorService server error:', err);
            this.startPromise = null;
            reject(err);
          });

          this.wss.on('listening', () => {
            const addr = this.wss?.address();
            const actualPort =
              typeof addr === 'object' && addr ? addr.port : port;
            debugLogger.log(
              `UiMirrorService listening on 127.0.0.1:${actualPort}`,
            );
            resolve();
          });
        } catch (err) {
          debugLogger.error(
            'UiMirrorService failed to start synchronously:',
            err,
          );
          this.startPromise = null;
          reject(err);
        }
      });
    })();

    return this.startPromise;
  }

  stop(): void {
    coreEvents.off(CoreEvent.HookStart, this.onHookStart);
    coreEvents.off(CoreEvent.HookEnd, this.onHookEnd);
    if (this.wss) {
      this.wss.close();
      this.wss = null;
      this.clients.clear();
    }
    this.startPromise = null;
  }

  broadcast(type: string, data: unknown): void {
    if (!this.wss || this.clients.size === 0) {
      return;
    }

    try {
      const payload = JSON.stringify({ type, data });
      // Append null byte as per specification
      const message = payload + '\0';

      for (const client of this.clients) {
        if (client.readyState === client.OPEN) {
          client.send(message, (err) => {
            if (err) {
              debugLogger.error('UiMirrorService send error:', err);
            }
          });
        }
      }
    } catch (err) {
      debugLogger.error('UiMirrorService broadcast error:', err);
    }
  }

  isRunning(): boolean {
    return this.wss !== null;
  }
}
