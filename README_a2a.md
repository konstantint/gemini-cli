# Gemini CLI A2A Endpoint

The Gemini CLI A2A (Agent-to-Agent) endpoint allows external agents or tools to
interact with an active Gemini CLI session. This enables features like remote
monitoring, shared tool execution, and collaborative development.

## 1. Getting Started

### Starting the Server

To enable the A2A server, start the Gemini CLI with the `--a2a-port` flag:

```bash
gemini --a2a-port 41243
```

The server binds to `127.0.0.1` for security and exposes both an HTTP metadata
endpoint and a WebSocket for real-time communication.

### Metadata (Agent Card)

You can verify the server is running by fetching the agent card:

```bash
curl http://localhost:41243/.well-known/agent-card.json
```

This returns JSON describing the agent's capabilities and the
`developer-profile` extension URI.

## 2. Communication Protocols

The A2A server supports two ways to interact:

### HTTP (Agent Client Protocol)

- **Create Task**: `POST /tasks` returns the current `sessionId`.
- **Send Message**: `POST /tasks/{taskId}/messages/stream` sends a prompt and
  returns an SSE (`text/event-stream`) of model activity.

### WebSocket

Connect to: `ws://localhost:41243/ws`

The WebSocket is multiplexed and receives all model activities regardless of
whether the prompt was sent via the TUI, HTTP, or another WebSocket client.

## 3. WebSocket / SSE Protocol

All messages are JSON-encoded. Most messages include a `taskId` which
corresponds to the CLI's `sessionId`.

### Sending a Prompt (JSON-RPC)

To inject a prompt into the CLI session:

```json
{
  "jsonrpc": "2.0",
  "method": "message/stream",
  "params": {
    "message": {
      "content": {
        "text": "List the files in the current directory"
      }
    }
  }
}
```

### Receiving Updates

The server broadcasts several types of events:

- **THOUGHT**: The model's internal reasoning.
- **TEXT_CONTENT**: Incremental text output from the model.
- **TOOL_CALL_UPDATE**: Updates on tool status (PENDING, EXECUTING, SUCCEEDED,
  FAILED, CANCELLED).
- **CONSOLE_LOG**: Logs emitted by the CLI (e.g., info, warn, error).

**Example TEXT_CONTENT broadcast:**

```json
{
  "kind": "TEXT_CONTENT",
  "content": {
    "text": "I will list the files for you."
  },
  "taskId": "your-session-id"
}
```

## 4. Tool Confirmation Workflow

When the CLI encounters a tool that requires user approval (and `--yolo` is not
set), it broadcasts a `TOOL_CALL_UPDATE` with `status: "PENDING"` and a
`confirmation_request` object.

### Handling a Confirmation Request

The client receives a message like this:

```json
{
  "kind": "TOOL_CALL_UPDATE",
  "tool_call_id": "uuid-correlation-id",
  "status": "PENDING",
  "tool_name": "run_shell_command",
  "confirmation_request": {
    "options": [
      { "id": "proceed_once", "name": "Allow Once" },
      { "id": "cancel", "name": "Cancel" }
    ],
    "details": {
      "execute_details": { "command": "rm -rf /" }
    }
  },
  "taskId": "..."
}
```

### Responding to Confirmation

To approve or deny the request, send a `TOOL_CALL_CONFIRMATION` message:

```json
{
  "jsonrpc": "2.0",
  "method": "message/stream",
  "params": {
    "message": {
      "content": {
        "data": {
          "kind": "TOOL_CALL_CONFIRMATION",
          "tool_call_id": "uuid-correlation-id",
          "selected_option_id": "proceed_once"
        }
      }
    }
  }
}
```

## 5. Testing & Debugging

### Using `wscat`

The easiest way to manually test the connection is using `wscat`:

```bash
# Install wscat if needed
npm install -g wscat

# Connect to the server
wscat -c ws://localhost:41243/ws
```

### Debug Logs

The A2A service uses the CLI's internal `debugLogger`. You can see A2A-specific
logs by running the CLI with the `--debug` flag:

```bash
gemini --a2a-port 41243 --debug
```

Look for logs prefixed with `[A2AService]` or `A2A client connected`.
