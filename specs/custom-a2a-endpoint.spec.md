# Requirements Specification: Custom A2A Endpoint for Gemini CLI

## 1. Overview

This specification defines a new feature for the Gemini CLI to expose an A2A
(Agent-to-Agent) HTTP/WebSocket endpoint using the Agent Client Protocol (ACP).
This endpoint will allow external agents or tools to interact with a running
Gemini CLI session, supporting multiple simultaneous clients.

## 2. CLI Integration

### 2.1 Invocation

The CLI must support a new optional argument: `--a2a-port <port>`.

- **Argument:** `--a2a-port`
- **Type:** `number`
- **Default:** `undefined` (feature disabled)
- **Description:** Exposes an A2A HTTP/WebSocket endpoint on the specified port.

### 2.2 Activation

When `--a2a-port` is provided, the CLI must:

1. Start the TUI (Ink) as usual.
2. Simultaneously start an A2A server listening on the specified port on
   `localhost`.
3. Ensure the A2A server and TUI share the same underlying Gemini model session
   and configuration.

## 3. A2A Server Architecture

### 3.1 Technology Stack

- **HTTP Server:** Express (consistent with `packages/a2a-server`).
- **WebSocket Server:** `ws` for real-time broadcasting and multiplexing.
- **Protocol:** A2A Protocol (utilizing `@a2a-js/sdk`) with the
  `development-tool` extension.
- **Data Formats:** JSON-RPC for commands/requests, and SSE-like events over
  WebSocket for streaming.

### 3.2 Endpoint Support

The server must provide:

- `GET /.well-known/agent-card.json`: A2A agent card with `development-tool`
  extension URI.
- `GET /ws`: WebSocket endpoint for multiplexed A2A communication.

## 4. Multiplexing Strategy

### 4.1 Broadcast Output (CLI -> All Clients)

The A2A service must capture all model activity and broadcast it as A2A
`TaskStatusUpdateEvent` messages to all connected clients:

- **Text Content:** `TEXT_CONTENT` kind with `TextPart`.
- **Thinking:** `THOUGHT` kind with `AgentThought` schema.
- **Tool Updates:** `TOOL_CALL_UPDATE` kind with `ToolCall` schema (including
  `live_content` for shell output).

### 4.2 Multiplexed Task ID

To support multiple clients interacting with the same session:

1. All connected clients should share a "Virtual Task ID" representing the
   current CLI session's active turn.
2. Any message sent by any client is treated as a new turn in this shared
   session.

## 5. Tool Permission Workflow

### 5.1 Notification (CLI -> All Clients)

When a tool requires confirmation:

1. The A2A server broadcasts a `TaskStatusUpdateEvent` with
   `kind: TOOL_CALL_UPDATE`.
2. The `ToolCall` object must have `status: PENDING` and a populated
   `confirmation_request` field.
3. The `confirmation_request` must follow the schema defined in the
   `development-tool` extension RFC:
   - Include `options` (e.g., `proceed_once`, `cancel`).
   - Include specific details (e.g., `execute_details`, `file_edit_details`).
   - Include a `correlationId` in the metadata or as part of the `tool_call_id`
     to allow the CLI to match the response.

### 5.2 Response (Client -> CLI)

When a client sends a `ToolCallConfirmation` (as a `message/stream` request or a
specific WebSocket message):

1. The A2A server extracts the `selected_option_id` and any `modified_details`.
2. It publishes a `TOOL_CONFIRMATION_RESPONSE` to the CLI's `MessageBus` with
   the matching `correlationId`.
3. The CLI processes this as if the user clicked the corresponding button in the
   TUI.
4. The A2A server then broadcasts a `TOOL_CALL_UPDATE` with `status: EXECUTING`
   (or `CANCELLED`) to all clients.

## 6. TUI Synchronization

### 6.1 Consistent View

Since both the TUI and A2A clients share the same session:

1. Any choice made via an A2A client MUST resolve the corresponding dialog in
   the TUI (closing it and proceeding).
2. Any choice made via the TUI MUST resolve the pending request for all A2A
   clients (e.g., by sending a `TOOL_CALL_UPDATE` with the terminal status).
3. If multiple A2A clients (or the TUI) attempt to resolve the same permission
   request, the first response must be honored and subsequent attempts must be
   ignored or return an informative error.

### 6.2 Input Reflection

1. Messages sent via A2A MUST appear in the TUI history as if they were typed by
   the user (perhaps with a small indicator like `[A2A]`).
2. Model output triggered by an A2A message MUST be displayed in the TUI.

## 7. Implementation Considerations

### 7.1 Shared State

- Both TUI and A2A must operate on the same `Config` and `GeminiChat` instances.
- The `AppContainer` in `packages/cli` should be modified to allow external
  input injection (e.g., via `appEvents`).

### 7.2 Security

- By default, the A2A server MUST listen only on `localhost` (127.0.0.1) to
  prevent unauthorized remote access.
- No authentication is required for this initial implementation beyond local
  access, but the architecture should be extensible for future auth schemes.

### 7.3 Concurrency

- Handle race conditions where multiple clients (or a client and the TUI user)
  try to respond to the same permission request simultaneously. The first
  response should win, and subsequent responses should be ignored or return an
  error.

## 8. Success Criteria

1. Invoking `gemini --a2a-port 1234` starts the CLI and an ACP server on
   port 1234.
2. Connecting to `ws://localhost:1234/ws` with an ACP client allows sending
   prompts and receiving output.
3. Output typed in the TUI is received by the ACP client.
4. Prompts sent by the ACP client are displayed in the TUI.
5. Tool permission dialogs triggered by the CLI are sent to the ACP client, and
   the client's choice resolves the dialog in the TUI.
