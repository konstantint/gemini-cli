# UI Mirror - Implementation Status

## 1. Completed Tasks

### 1.1 Core Infrastructure

- [x] **Specification**: Created `specs/ui-mirror.spec.md` defining the protocol
      and event schemas.
- [x] **Configuration**: Added `--ui-port` flag to
      `packages/cli/src/config/config.ts`.
- [x] **Service**: Implemented `UiMirrorService` in
      `packages/cli/src/services/uiMirrorService.ts`.
  - Singleton pattern.
  - WebSocket server management using `ws`.
  - Message broadcasting with JSON + Null-byte termination.
  - Idempotent `start()` with race condition protection.
- [x] **CLI Lifecycle**: Integrated service startup and cleanup in
      `packages/cli/src/gemini.tsx`.

### 1.2 Instrumentation (Broadcasting)

- [x] **User Messages**: Broadcasts `user_message` when input is submitted.
- [x] **Model Output**: Broadcasts `model_output` for streaming text chunks.
- [x] **Tool Interaction**:
  - Broadcasts `tool_call` when a tool is requested.
  - Broadcasts `tool_output` when a tool completes.
- [x] **Agent State**: Broadcasts `idle` when the conversation turn finishes.
- [x] **Permissions**:
  - Broadcasts `permission_dialog` for both Auth Consent and File Access
    requests.
  - Broadcasts `permission_selection` when the user makes a choice.
- [x] **System Events**: Broadcasts `hook` events by listening to `coreEvents`
      (`HookStart`, `HookEnd`).

### 1.3 Tooling & Fixes

- [x] **Test Rig Fix**: Updated `packages/test-utils/src/test-rig.ts` to support
      passing extra `args` in `runInteractive`.
- [x] **Port 0 Support**: Added support for dynamic port allocation
      (`--ui-port 0`) and discovery via `coreEvents.emitFeedback`.

### 1.4 Verification

- [x] **Unit Tests**: `packages/cli/src/services/uiMirrorService.test.ts`
      (verifies protocol and singleton behavior).
- [x] **Integration Tests**: `integration-tests/ui-mirror.test.ts` (verifies
      end-to-end event streaming in a real CLI session).
- [x] **Build**: Verified that `packages/cli` builds successfully with the new
      service and dependencies.

## 2. Outstanding / Next Steps

### 2.1 Refinement

- [ ] **Event Schema Formalization**: While the implementation matches the spec,
      consider creating formal TypeScript interfaces for all event data
      structures in a shared location (e.g.,
      `packages/core/src/types/ui-mirror.ts`) if this feature is intended for
      external SDK consumption.
- [ ] **Security**: Currently, the server binds to `127.0.0.1`. Consider if any
      authentication (e.g., a simple token passed via URL) is needed for the
      WebSocket connection to prevent other local users from snooping on the
      event stream.

### 2.2 UI Coverage

- [ ] **Settings Changes**: Currently, changes to settings made via the UI (if
      any) are not broadcast.
- [ ] **Error States**: Ensure critical CLI errors that don't pass through the
      standard message stream are also broadcast as `error` events.

### 2.3 Documentation

- [ ] **User Guide**: Add a section to the project documentation explaining how
      to use `--ui-port` and the expected message format for third-party UI
      developers.
