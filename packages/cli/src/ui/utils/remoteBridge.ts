/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
type MessageHandler = (message: string) => void;
type HistoryProvider = () => unknown[];

class TuiRemoteBridge {
  private onMessage: MessageHandler | null = null;
  private getHistory: HistoryProvider | null = null;

  register(onMessage: MessageHandler, getHistory: HistoryProvider) {
    this.onMessage = onMessage;
    this.getHistory = getHistory;
  }

  unregister() {
    this.onMessage = null;
    this.getHistory = null;
  }

  submitMessage(msg: string) {
    if (this.onMessage) {
      this.onMessage(msg);
      return true;
    }
    return false;
  }

  getCurrentHistory() {
    return this.getHistory?.() || [];
  }

  isRegistered() {
    return this.onMessage !== null && this.getHistory !== null;
  }
}

export const tuiRemoteBridge = new TuiRemoteBridge();
