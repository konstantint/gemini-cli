# UI Mirror Specification

## 1. Overview

The "UI Mirror" feature enables an alternative UI (e.g., a web interface) to
connect to the Gemini CLI and receive a real-time stream of UI events. This
allows the CLI to drive a rich graphical interface while maintaining its
terminal-based core.

## 2. Architecture

The feature will be implemented as a new service within the `packages/cli`
workspace, loosely coupled with the existing React/Ink UI.

### 2.1 Components

- **`UiMirrorService`**: A singleton service responsible for managing the
  WebSocket server and broadcasting events to connected clients.
- **Integration Points**:
  - `packages/cli/src/config/config.ts`: Parsing the `--ui-port` flag.
  - `packages/cli/src/gemini.tsx`: Initializing the service at startup.
  - `packages/cli/src/ui/hooks/useGeminiStream.ts`: Instrumenting conversation
    events (User Message, Model Output, Tool Calls).
  - `packages/cli/src/ui/AppContainer.tsx`: Instrumenting UI-specific events
    (Permissions, Hooks).

### 2.2 Data Flow

1.  User acts in the CLI (e.g., sends a message).
2.  The corresponding React hook (e.g., `submitQuery`) calls
    `UiMirrorService.getInstance().broadcast(...)`.
3.  `UiMirrorService` serializes the event to JSON, appends a null byte, and
    sends it to all active WebSocket connections.

## 3. Protocol

- **Transport**: WebSocket (RFC 6455).
- **Endpoint**: `ws://localhost:<ui-port>/`
- **Message Format**: Text frames containing a JSON object followed by a null
  byte (`\0`).
  - _Note_: While WebSocket frames provide their own framing, the requirement
    specifically asks for a null-byte delimiter. We will append `\0` to the JSON
    string payload of each WebSocket message.

### 3.1 Handshake

No complex handshake is required. Clients simply connect to the WebSocket URL.

## 4. Event Reference

All events follow this structure:

```json
{
  "type": "<event_type>",
  "data": <event_specific_data>
}
```

### 4.1 `user_message`

Triggered when the user sends a message (prompt or command).

- **Source**: `useGeminiStream.ts` -> `submitQuery`
- **Data**:
  ```json
  {
    "text": "Write a python script to hello world"
  }
  ```

### 4.2 `model_output`

Triggered when the model streams a chunk of text.

- **Source**: `useGeminiStream.ts` -> `handleContentEvent`
- **Data**:
  ```json
  {
    "text": "Here is the "
  }
  ```

### 4.3 `tool_call`

Triggered when the model requests a tool execution.

- **Source**: `useGeminiStream.ts` -> `processGeminiStreamEvents` (handling
  `ToolCallRequest`)
- **Data**:
  ```json
  {
    "callId": "call_12345",
    "name": "run_shell_command",
    "args": {
      "command": "echo hello"
    }
  }
  ```

### 4.4 `tool_output`

Triggered when a tool completes execution.

- **Source**: `useGeminiStream.ts` -> `handleCompletedTools`
- **Data**:
  `json     {       "callId": "call_12345",       "output": "hello "     }     `

### 4.5 `idle`

Triggered when the agent finishes a turn (streaming state becomes `Idle`).

- **Source**: `useGeminiStream.ts` -> `useEffect` on `streamingState`
- **Data**: `{}` (Empty object)

### 4.6 `permission_dialog`

Triggered when the CLI requests user confirmation for an action.

- **Source**: `AppContainer.tsx` -> `checkPermissions` /
  `setPermissionConfirmationRequest`
- **Data**:
  ```json
  {
    "id": "req_abc123", // generated ID to link with selection
    "type": "file_access", // or "command_run"
    "options": ["Allow", "Deny", "Always Allow"]
  }
  ```

### 4.7 `permission_selection`

Triggered when the user makes a choice in the permission dialog.

- **Source**: `AppContainer.tsx` -> Callback in `permissionConfirmationRequest`
- **Data**:
  ```json
  {
    "id": "req_abc123",
    "selection": "Allow"
  }
  ```

### 4.8 `hook`

Triggered when a system hook fires (start and end).

- **Source**: `AppContainer.tsx` (listening to `coreEvents.HookStart` /
  `HookEnd`)
- **Data**:
  ```json
  {
    "hookName": "on_session_start",
    "eventName": "hook_start", // or "hook_end"
    "success": true // only for hook_end
  }
  ```

## 5. Implementation Plan

### 5.1 Configuration

1.  Modify `packages/cli/src/config/config.ts`:
    - Add `uiPort` to `CliArgs` interface.
    - Add `ui-port` option to `yargs` configuration in `parseArguments`.

### 5.2 Service Implementation

1.  Create `packages/cli/src/services/uiMirrorService.ts`.
2.  Implement `UiMirrorService` class:
    - `private static instance: UiMirrorService`
    - `start(port: number): Promise<void>` (uses `ws` library)
    - `broadcast(type: string, data: any): void`
    - `stop(): void`

### 5.3 Instrumentation

1.  **Startup**: In `packages/cli/src/gemini.tsx`, after parsing args:
    ```typescript
    if (argv.uiPort) {
      UiMirrorService.getInstance().start(argv.uiPort);
    }
    ```
2.  **Streaming Hooks**: In `packages/cli/src/ui/hooks/useGeminiStream.ts`:
    - Inject calls to `UiMirrorService.getInstance().broadcast()` in
      `submitQuery`, `handleContentEvent`, `scheduleToolCalls` (for
      `tool_call`), and `handleCompletedTools`.
    - Monitor `streamingState` changes to emit `idle`.
3.  **UI Hooks**: In `packages/cli/src/ui/AppContainer.tsx`:
    - Wrap `setPermissionConfirmationRequest` to emit `permission_dialog`.
    - Wrap the `onComplete` callback of permissions to emit
      `permission_selection`.
    - Listen to `coreEvents` for hooks and forward them.

## 6. Testing Strategy

### 6.1 Unit Tests

- Create `packages/cli/src/services/uiMirrorService.test.ts`.
- Verify that `broadcast` sends correct JSON + `\0` to mock WebSocket clients.
- Verify `start` and `stop` lifecycle.

### 6.2 Integration Tests

- Create a new integration test `integration-tests/ui-mirror.test.ts`.
- Spawn the CLI with `--ui-port 9999`.
- Connect a real `WebSocket` client to `ws://localhost:9999`.
- Send an input to the CLI (stdin).
- Verify the client receives `user_message`, `model_output`, and `idle` events
  in the correct order and format.
