/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import {
  type Config,
  coreEvents,
  CoreEvent,
  GeminiEventType,
  MessageBusType,
  debugLogger,
  type ServerGeminiStreamEvent,
  type ToolConfirmationRequest,
  type ToolCallsUpdateMessage,
  type ToolCall,
  CoreToolCallStatus,
} from '@google/gemini-cli-core';
import { appEvents, AppEvent } from '../utils/events.js';

export class A2AService {
  private server: Server | null = null;
  private wss: WebSocketServer | null = null;
  private readonly clients: Set<WebSocket> = new Set();
  private readonly sseClients: Set<express.Response> = new Set();

  constructor(private readonly config: Config) {}

  start(): void {
    const port = this.config.getA2APort();
    if (!port) {
      return;
    }

    const app = express();

    // Request logging
    app.use((req, _res, next) => {
      debugLogger.debug(`[A2AService] ${req.method} ${req.url}`);
      next();
    });

    app.use(express.json());

    // Custom JSON error handler to prevent generic 400s without logging
    app.use(
      (
        err: unknown,
        req: express.Request,
        res: express.Response,
        next: express.NextFunction,
      ) => {
        if (err instanceof SyntaxError && 'body' in err) {
          debugLogger.error(`[A2AService] JSON Parse Error: ${err.message}`);
          return res.status(400).json({ error: 'Invalid JSON payload' });
        }
        next(err);
      },
    );

    app.get('/.well-known/agent-card.json', (_req, res) => {
      res.json({
        name: 'Gemini CLI Agent',
        description:
          'An agent that generates code based on natural language instructions.',
        url: `http://localhost:${port}/`,
        version: this.config.clientVersion,
        protocolVersion: '0.3.0',
        capabilities: {
          streaming: true,
          extensions: [
            {
              uri: 'https://github.com/google-gemini/gemini-cli/blob/main/docs/a2a/developer-profile/v0/spec.md',
              description:
                'An extension for interactive development tasks, enabling features like code generation, tool usage, and real-time status updates.',
              required: true,
            },
          ],
        },
        defaultInputModes: ['text'],
        defaultOutputModes: ['text'],
        skills: [
          {
            id: 'interactive_development',
            name: 'Interactive Development',
            description:
              'Supports real-time code generation, tool execution, and session interaction through the Gemini CLI.',
            tags: ['cli', 'interactive', 'development'],
            inputModes: ['text'],
            outputModes: ['text'],
          },
        ],
      });
    });

    app.post('/tasks', (_req, res) => {
      debugLogger.debug(`[A2AService] Task created: ${this.config.sessionId}`);
      res.status(201).json({ id: this.config.sessionId });
    });

    const handleStreamRequest = (
      req: express.Request,
      res: express.Response,
    ) => {
      const taskId = req.params.taskId || this.config.sessionId;
      debugLogger.debug(
        `[A2AService] Stream request for task: ${taskId}. Current session: ${this.config.sessionId}`,
      );

      // If taskId is provided in URL, it must match
      if (req.params.taskId && req.params.taskId !== this.config.sessionId) {
        debugLogger.warn(
          `[A2AService] Task ID mismatch: expected ${this.config.sessionId}, got ${req.params.taskId}`,
        );
        res.status(404).json({ error: 'Task not found' });
        return;
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      this.sseClients.add(res);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const body = req.body as Record<string, unknown>;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const params = body.params as Record<string, unknown> | undefined;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const message = params?.message as Record<string, unknown> | undefined;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const content = message?.content as Record<string, unknown> | undefined;

      const input = content?.text;
      if (typeof input === 'string') {
        appEvents.emit(AppEvent.InjectInput, input);
      } else {
        const data = content?.data;
        if (
          data &&
          typeof data === 'object' &&
          !Array.isArray(data) &&
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          (data as Record<string, unknown>).kind === 'TOOL_CALL_CONFIRMATION'
        ) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          const dataObj = data as Record<string, unknown>;
          const toolCallId = dataObj.tool_call_id;
          const selectedOptionId = dataObj.selected_option_id;
          if (
            typeof toolCallId === 'string' &&
            typeof selectedOptionId === 'string'
          ) {
            const messageBus = this.config.getMessageBus();
            void messageBus.publish({
              type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
              correlationId: toolCallId,
              confirmed: selectedOptionId === 'proceed_once',
            });
          }
        }
      }

      req.on('close', () => {
        this.sseClients.delete(res);
      });
    };

    // Support multiple common ACP and JSON-RPC routes
    app.post('/', handleStreamRequest);
    app.post('/v1/message:stream', handleStreamRequest);
    app.post('/v1/message\\:stream', handleStreamRequest); // Literal colon
    app.post('/tasks/:taskId/messages', handleStreamRequest);
    app.post('/tasks/:taskId/messages/stream', handleStreamRequest);
    app.post('/v1/tasks/:taskId/messages', handleStreamRequest);

    // Catch-all route for debugging
    app.use((req, res) => {
      const logMsg = `[A2AService] Unmatched ${req.method} ${req.url}`;
      debugLogger.warn(logMsg);
      coreEvents.emitFeedback('warning', logMsg);
      res.status(404).json({ error: 'Not Found' });
    });

    this.server = app.listen(port, '127.0.0.1', () => {
      debugLogger.log(`A2A server listening on http://localhost:${port}`);
    });

    this.wss = new WebSocketServer({ server: this.server, path: '/ws' });

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      debugLogger.debug('A2A client connected');

      ws.on('message', (data) => {
        try {
          const message: unknown = JSON.parse(data.toString());
          if (
            message &&
            typeof message === 'object' &&
            !Array.isArray(message)
          ) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
            this.handleClientMessage(message as Record<string, unknown>);
          }
        } catch (error) {
          debugLogger.error('Error parsing A2A client message:', error);
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        debugLogger.debug('A2A client disconnected');
      });
    });

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Listen for model activity
    coreEvents.on(CoreEvent.ModelActivity, (event: ServerGeminiStreamEvent) => {
      switch (event.type) {
        case GeminiEventType.Thought:
          this.broadcast({
            kind: 'THOUGHT',
            thought: {
              subject: event.value.subject,
              description: event.value.description,
            },
          });
          break;
        case GeminiEventType.Content:
          this.broadcast({
            kind: 'TEXT_CONTENT',
            content: {
              text: event.value,
            },
          });
          break;
        case GeminiEventType.ToolCallRequest:
          this.broadcast({
            kind: 'TOOL_CALL_UPDATE',
            tool_call_id: event.value.callId,
            status: 'PENDING',
            tool_name: event.value.name,
            input_parameters: event.value.args,
          });
          break;
        default:
          break;
      }
    });

    // Listen for tool confirmations and updates
    const messageBus = this.config.getMessageBus();
    messageBus.subscribe(
      MessageBusType.TOOL_CONFIRMATION_REQUEST,
      (message: ToolConfirmationRequest) => {
        this.broadcast({
          kind: 'TOOL_CALL_UPDATE',
          tool_call_id: message.correlationId,
          status: 'PENDING',
          tool_name: message.toolCall.name,
          confirmation_request: {
            options: [
              { id: 'proceed_once', name: 'Allow Once' },
              { id: 'cancel', name: 'Cancel' },
            ],
            details: this.mapConfirmationDetails(message),
          },
          metadata: {
            correlationId: message.correlationId,
          },
        });
      },
    );

    messageBus.subscribe(
      MessageBusType.TOOL_CALLS_UPDATE,
      (message: ToolCallsUpdateMessage) => {
        for (const toolCall of message.toolCalls) {
          this.broadcast({
            kind: 'TOOL_CALL_UPDATE',
            tool_call_id: toolCall.request.callId,
            status: this.mapToolCallStatus(toolCall.status),
            tool_name: toolCall.request.name,
            input_parameters: toolCall.request.args,
            live_content:
              'liveOutput' in toolCall &&
              typeof toolCall.liveOutput === 'string'
                ? toolCall.liveOutput
                : undefined,
            result: this.mapToolCallResult(toolCall),
          });
        }
      },
    );

    // Listen for stdout/stderr (primarily for shell output)
    coreEvents.on(CoreEvent.Output, (payload) => {
      const content =
        typeof payload.chunk === 'string'
          ? payload.chunk
          : new TextDecoder().decode(payload.chunk);
      this.broadcast({
        kind: 'TEXT_CONTENT',
        content: {
          text: content,
        },
        isStderr: payload.isStderr,
      });
    });

    coreEvents.on(CoreEvent.ConsoleLog, (payload) => {
      this.broadcast({
        kind: 'CONSOLE_LOG',
        type: payload.type,
        content: payload.content,
      });
    });
  }

  private mapToolCallStatus(status: CoreToolCallStatus): string {
    switch (status) {
      case CoreToolCallStatus.AwaitingApproval:
        return 'PENDING';
      case CoreToolCallStatus.Executing:
        return 'EXECUTING';
      case CoreToolCallStatus.Success:
        return 'SUCCEEDED';
      case CoreToolCallStatus.Error:
        return 'FAILED';
      case CoreToolCallStatus.Cancelled:
        return 'CANCELLED';
      default:
        return 'PENDING';
    }
  }

  private mapToolCallResult(toolCall: ToolCall): unknown {
    if (toolCall.status === CoreToolCallStatus.Success) {
      return {
        output: {
          text: toolCall.response.resultDisplay || 'Success',
        },
      };
    } else if (toolCall.status === CoreToolCallStatus.Error) {
      return {
        error: {
          message: toolCall.response.error?.message || 'Unknown error',
        },
      };
    }
    return undefined;
  }

  private handleClientMessage(message: Record<string, unknown>): void {
    // Basic implementation of message/stream and ToolCallConfirmation
    if (message.method === 'message/stream') {
      const params = message.params;
      if (params && typeof params === 'object' && !Array.isArray(params)) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        const msg = (params as Record<string, unknown>).message;
        if (msg && typeof msg === 'object' && !Array.isArray(msg)) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          const content = (msg as Record<string, unknown>).content;
          if (
            content &&
            typeof content === 'object' &&
            !Array.isArray(content)
          ) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
            const data = (content as Record<string, unknown>).data;
            if (data && typeof data === 'object' && !Array.isArray(data)) {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
              const dataObj = data as Record<string, unknown>;
              if (dataObj.kind === 'TOOL_CALL_CONFIRMATION') {
                const toolCallId = dataObj.tool_call_id;
                const selectedOptionId = dataObj.selected_option_id;
                if (
                  typeof toolCallId === 'string' &&
                  typeof selectedOptionId === 'string'
                ) {
                  const messageBus = this.config.getMessageBus();
                  void messageBus.publish({
                    type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
                    correlationId: toolCallId,
                    confirmed: selectedOptionId === 'proceed_once',
                  });
                }
              }
            } else {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
              const input = (content as Record<string, unknown>).text;
              if (typeof input === 'string') {
                appEvents.emit(AppEvent.InjectInput, input);
              }
            }
          }
        }
      }
    }
  }

  private broadcast(message: Record<string, unknown>): void {
    const payload = {
      ...message,
      taskId: this.config.sessionId,
    };
    const data = JSON.stringify(payload);

    // Broadcast to WebSocket clients
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }

    // Broadcast to SSE clients
    const jsonRpcResponse = {
      jsonrpc: '2.0',
      id: payload.taskId,
      result: payload,
    };
    const sseData = `data: ${JSON.stringify(jsonRpcResponse)}\n\n`;
    for (const res of this.sseClients) {
      res.write(sseData);
    }
  }

  private mapConfirmationDetails(message: ToolConfirmationRequest): unknown {
    const details = message.details;
    if (!details) {
      return { generic_details: { description: 'Tool confirmation required' } };
    }

    switch (details.type) {
      case 'exec':
        return {
          execute_details: {
            command: details.command,
          },
        };
      case 'edit':
        return {
          file_edit_details: {
            file_name: details.fileName,
            file_path: details.filePath,
            old_content: details.originalContent,
            new_content: details.newContent,
            formatted_diff: details.fileDiff,
          },
        };
      case 'mcp':
        return {
          mcp_details: {
            server_name: details.serverName,
            tool_name: details.toolName,
          },
        };
      default:
        return {
          generic_details: {
            description:
              (details as Record<string, unknown>).title ||
              'Tool confirmation required',
          },
        };
    }
  }

  stop(): void {
    if (this.wss) {
      this.wss.close();
    }
    for (const res of this.sseClients) {
      res.end();
    }
    this.sseClients.clear();
    if (this.server) {
      this.server.close();
    }
  }
}
