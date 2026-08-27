import { PORTABLE_CLIENT_PROTOCOL_VERSION } from "@t3tools/contracts";

export const capabilities = {
  threadWorktrees: true,
  workspaceFiles: true,
  backgroundActivity: true,
  executionSessions: true,
  todos: true,
  portableClientProtocol: PORTABLE_CLIENT_PROTOCOL_VERSION,
} as const;
