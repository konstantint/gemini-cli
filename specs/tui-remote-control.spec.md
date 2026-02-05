# Specification: Gemini CLI TUI Remote Control

## 1. Overview

This specification defines the implementation of an internal HTTP server within
the Gemini CLI TUI process. This server will allow external programs to
programmatically interact with an **active** TUI session. Actions performed via
this interface (like sending a message) must be reflected in the TUI's visual
history and trigger the agent's response exactly as if the user had typed the
command manually.

## 2. Context

The Gemini CLI TUI is a React/Ink application. Its core state (history,
streaming status) and actions (submitting queries) are managed via hooks in
`packages/cli/src/ui/AppContainer.tsx` and `useGeminiStream.ts`. Currently,
there is no entry point for external processes to trigger these internal React
actions.

## 3. Requirements

### 3.1 Functional Requirements

1.  **POST `/message`**: Accepts a JSON body `{"message": "string"}`.
    - Triggers the TUI's submission logic (`handleFinalSubmit`).
    - The message appears in the TUI history immediately.
    - The agent begins responding in the TUI.
2.  **GET `/history`**: Returns the current chat history as a JSON array.
    - Query Parameter: `limit` (optional integer) to return only the last $N$
      messages.
    - Filters out internal/system UI items to return clean message objects.
3.  **Port Management**:
    - The server should listen on a port defined by the environment variable
      `GEMINI_CLI_REMOTE_PORT`.
    - If the variable is not set, the feature should be disabled by default.
4.  **Cleanup**: The server must close gracefully when the TUI exits.

### 3.2 Constraints

- **No New Dependencies**: Use Node.js built-in `http` and `url` modules to
  avoid bloating `packages/cli`.
- **Process Isolation**: The server must run inside the TUI process to access
  its memory-resident React state.

## 4. Technical Implementation

### 4.1 The Bridge Pattern

Since the HTTP server runs at the Node process level and the state lives inside
React, we need a "Bridge" object.

**Location**: `packages/cli/src/ui/utils/remoteBridge.ts`

```typescript
type MessageHandler = (message: string) => void;
type HistoryProvider = () => any[];

class TuiRemoteBridge {
  private onMessage: MessageHandler | null = null;
  private getHistory: HistoryProvider | null = null;

  register(onMessage: MessageHandler, getHistory: HistoryProvider) {
    this.onMessage = onMessage;
    this.getHistory = getHistory;
  }

  submitMessage(msg: string) {
    this.onMessage?.(msg);
  }

  getCurrentHistory() {
    return this.getHistory?.() || [];
  }
}

export const tuiRemoteBridge = new TuiRemoteBridge();
```

### 4.2 The HTTP Listener

**Location**: `packages/cli/src/core/remoteServer.ts`

- Implement a function `startRemoteServer(port: number)` using
  `http.createServer`.
- Route `POST /message`: Call `tuiRemoteBridge.submitMessage(body.message)`.
- Route `GET /history`: Call `tuiRemoteBridge.getCurrentHistory()` and return as
  JSON.

**Security**: The listener MUST only bind to a port on `localhost`, preventing
external access.

### 4.3 Integration Points

1.  **`packages/cli/src/gemini.tsx`**:
    - In `startInteractiveUI`, check for `process.env.GEMINI_CLI_REMOTE_PORT`.
    - If present, call `startRemoteServer(port)`.
    - Register a cleanup task to close the server on exit.

2.  **`packages/cli/src/ui/AppContainer.tsx`**:
    - Inside the component, use an `useEffect` to register the local
      `handleFinalSubmit` and the current `history` array with the
      `tuiRemoteBridge`.
    - Ensure the registration is cleared when the component unmounts.

## 5. API Specification

### 5.1 POST `/message`

- **Body**: `{"message": "Hello Gemini"}`
- **Response**: `200 OK` if triggered, `503 Service Unavailable` if the TUI
  bridge is not yet registered.

### 5.2 GET `/history`

- **Query Params**: `limit=10`
- **Response**: `200 OK` with body:
  ```json
  [
    { "role": "user", "text": "Hello" },
    { "role": "model", "text": "Hi there!" }
  ]
  ```

## 6. Verification Plan

### 6.1 Automated Testing

- **Unit Test**: Create `packages/cli/src/core/remoteServer.test.ts` to test the
  HTTP routing logic in isolation using mocks for the bridge.
- **Integration Test**: A new test in `integration-tests/` that:
  1.  Starts the CLI with a specific port.
  2.  Uses `fetch` or `curl` to POST a message.
  3.  Verifies the GET `/history` endpoint returns the sent message.

### 6.2 Manual Verification

1.  Open a terminal and run: `GEMINI_CLI_TUI_REMOTE_PORT=3000 gemini`.
2.  In a second terminal, run:
    ```bash
    curl -X POST http://localhost:3000/message -H "Content-Type: application/json" -d '{"message": "list files"}'
    ```
3.  **Expectation**: The TUI in terminal 1 should immediately show "list files"
    being sent and the agent starting to respond.
4.  Run:
    ```bash
    curl http://localhost:3000/history
    ```
5.  **Expectation**: Returns the JSON representation of the conversation visible
    on screen.
