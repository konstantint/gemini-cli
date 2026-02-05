/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import http from 'node:http';
import { URL } from 'node:url';
import { tuiRemoteBridge } from '../ui/utils/remoteBridge.js';
import { type HistoryItem } from '../ui/types.js';

export function startRemoteServer(port: number): http.Server {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    if (req.method === 'POST' && url.pathname === '/message') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        try {
          const { message } = JSON.parse(body);
          if (!message) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Message is required' }));
            return;
          }

          if (!tuiRemoteBridge.isRegistered()) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({ error: 'TUI bridge is not yet registered' }),
            );
            return;
          }

          tuiRemoteBridge.submitMessage(message);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'Message submitted' }));
        } catch (_error) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/history') {
      if (!tuiRemoteBridge.isRegistered()) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'TUI bridge is not yet registered' }));
        return;
      }

      const limit = parseInt(url.searchParams.get('limit') || '0', 10);
      let history = tuiRemoteBridge.getCurrentHistory();

      // Basic filtering to return clean message objects if they have a type and text
      history = (history as HistoryItem[])
        .filter(
          (item: HistoryItem) =>
            (item.type === 'user' ||
              item.type === 'gemini' ||
              item.type === 'gemini_content') &&
            item.text,
        )
        .map((item: HistoryItem) => ({
          role: item.type === 'user' ? 'user' : 'model',
          text: item.text,
        }));

      if (limit > 0) {
        history = history.slice(-limit);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(history));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  });

  server.listen(port, '127.0.0.1', () => {
    // Server started
  });

  return server;
}
