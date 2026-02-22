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
      debugLogger.warn('UiMirrorService already running.');
      return;
    }

    coreEvents.on(CoreEvent.HookStart, this.onHookStart);
    coreEvents.on(CoreEvent.HookEnd, this.onHookEnd);

    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({ port });

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
          reject(err);
        });

        this.wss.on('listening', () => {
          debugLogger.log(`UiMirrorService listening on port ${port}`);
          resolve();
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  stop(): void {
    coreEvents.off(CoreEvent.HookStart, this.onHookStart);
    coreEvents.off(CoreEvent.HookEnd, this.onHookEnd);
    if (this.wss) {
      this.wss.close();
      this.wss = null;
      this.clients.clear();
    }
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
