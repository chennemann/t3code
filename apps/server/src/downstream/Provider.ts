import { WORKSPACE_PROJECT_ID, type ProjectId } from "@t3tools/contracts";
import type * as FileSystem from "effect/FileSystem";

export function prepareWorkingDirectory(input: {
  readonly projectId: ProjectId;
  readonly cwd: string | null | undefined;
  readonly fileSystem: FileSystem.FileSystem;
}) {
  return input.projectId === WORKSPACE_PROJECT_ID && input.cwd
    ? input.fileSystem.makeDirectory(input.cwd, { recursive: true })
    : null;
}

export function decorateUserMessage(input: {
  readonly message: string;
  readonly agentInstructions?: string;
}): string {
  return input.agentInstructions
    ? `<agent_instructions>\n${input.agentInstructions}\n</agent_instructions>\n\n<user_message>\n${input.message}\n</user_message>`
    : input.message;
}
