import type { AgentFeedbackMode } from "@t3tools/contracts";

import type { ProviderAdapterV2RuntimePolicy } from "./ProviderAdapter.ts";

/** None while agent feedback is off, so users who never opt in pay no context for it. */
export const AGENT_FEEDBACK_INSTRUCTIONS = {
  off: "",
  "on-request": "Use `t3_feedback` only when the user asks you to send T3 feedback.",
  auto: "`t3_feedback` reports are wanted and cheap. Send one, then continue, when a T3 tool or `t3` command fails or gives a wrong result, the user corrects how you use T3 Code, or a T3 capability you looked for is missing. Once per problem; also when the user asks. Only about T3 Code, never the user's code or other tools.",
} satisfies Record<AgentFeedbackMode, string>;

import { DEFAULT_PULL_REQUEST_LINKING_INSTRUCTIONS } from "@t3tools/contracts";

export function buildPullRequestLinkingInstructions(
  instructions = DEFAULT_PULL_REQUEST_LINKING_INSTRUCTIONS,
): string {
  return instructions.trim()
    ? `<pull_request_linking>\n${instructions.trim()}\n</pull_request_linking>`
    : "";
}

export const PULL_REQUEST_LINKING_INSTRUCTIONS = buildPullRequestLinkingInstructions();

/** Omit model and effort when the harness manages them dynamically. */
export function buildRuntimeInstructions(runtime: {
  readonly harness: string;
  readonly agentFeedback?: AgentFeedbackMode;
  readonly pullRequestLinkingInstructions?: string | undefined;
  readonly model?: string | undefined;
  readonly modelName?: string | undefined;
  readonly reasoningEffort?: string | undefined;
  /** False when the session's system prompt already carries the linking instructions. */
  readonly pullRequestLinking?: boolean;
  /** Adds the folder list of a multi-folder thread. */
  readonly runtimePolicy?: Pick<ProviderAdapterV2RuntimePolicy, "cwd" | "workspace"> | undefined;
}): string {
  const harness = toSingleLine(runtime.harness);
  const model = toSingleLine(runtime.model ?? "");
  const modelName = toSingleLine(runtime.modelName ?? "");
  const effort = toSingleLine(runtime.reasoningEffort ?? "");
  const modelLabel =
    modelName && modelName !== model ? `${modelName} (model slug: ${model})` : model;
  const modelInfo = model && model !== "auto" && model !== "default" ? `, as ${modelLabel}` : "";
  const effortInfo = effort ? ` with ${effort} reasoning effort` : "";
  const runtimeInfo = `<runtime_info>In case you're asked: you are running in T3 Code through the ${harness} harness${modelInfo}${effortInfo}. No need to mention this otherwise. You can embed images, video, and audio using Markdown image syntax with absolute file paths. Link every other file you cite or produce by its absolute path, as in [http.ts:42](/abs/path/http.ts:42), so the user can open it in T3 Code's files viewer.</runtime_info>`;
  const feedbackLine = AGENT_FEEDBACK_INSTRUCTIONS[runtime.agentFeedback ?? "off"];
  const feedback = feedbackLine ? `\n${feedbackLine}` : "";
  const workspace =
    runtime.runtimePolicy === undefined ? "" : buildWorkspaceInstructions(runtime.runtimePolicy);
  const linking = buildPullRequestLinkingInstructions(runtime.pullRequestLinkingInstructions);
  const linked =
    runtime.pullRequestLinking === false || !linking ? runtimeInfo : `${runtimeInfo}\n\n${linking}`;
  return [linked + feedback, ...(workspace === "" ? [] : [workspace])].join("\n\n");
}

function toSingleLine(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}

// Codex truncates context entries over 4,000 bytes, and this block is sent as its own entry.
const WORKSPACE_INSTRUCTIONS_MAX_BYTES = 3_600;
const FOLDER_NAME_MAX_LENGTH = 64;
// Control characters and Unicode line separators would let a name or path add lines.
const LINE_BREAKING = /[\p{Cc}\p{Zl}\p{Zp}]/gu;
const textEncoder = new TextEncoder();

const byteLength = (value: string) => textEncoder.encode(value).length;

/** Names come from users and disk; keep each one a short label that cannot close the block. */
function folderLabel(name: string): string {
  const label = Array.from(
    name.replaceAll(LINE_BREAKING, " ").replaceAll(/[<>`]/g, " ").replaceAll(/\s+/g, " ").trim(),
  );
  if (label.length === 0) return "folder";
  return label.length > FOLDER_NAME_MAX_LENGTH
    ? `${label.slice(0, FOLDER_NAME_MAX_LENGTH - 1).join("")}…`
    : label.join("");
}

const folderPath = (value: string) =>
  value.replaceAll(LINE_BREAKING, "?").replaceAll("<", "‹").replaceAll(">", "›");

/** Lists a multi-folder thread's folders. Empty for single-folder threads, so their text is unchanged. */
export function buildWorkspaceInstructions(
  runtimePolicy: Pick<ProviderAdapterV2RuntimePolicy, "cwd" | "workspace">,
): string {
  const workspace = runtimePolicy.workspace;
  if (workspace === undefined || workspace.folders.length === 0) return "";
  const head = [
    "<workspace_folders>",
    "This project spans several folders. Each Git repository has its own history and branches: run Git commands inside the repository you change, and commit each one separately.",
    ...(runtimePolicy.cwd === null
      ? []
      : [`- Your working directory: ${folderPath(runtimePolicy.cwd)}`]),
  ];
  const tail = ["</workspace_folders>"];
  const entries = workspace.folders.map(
    (folder) =>
      `- ${folderLabel(folder.name)} (${folder.isGitRepository ? "Git repository" : "folder"}): ${folderPath(folder.path)}`,
  );
  // Reserve room for the line that counts folders left out.
  let budget = WORKSPACE_INSTRUCTIONS_MAX_BYTES - byteLength([...head, ...tail].join("\n")) - 32;
  const shown: Array<string> = [];
  for (const entry of entries) {
    budget -= byteLength(entry) + 1;
    if (budget < 0) break;
    shown.push(entry);
  }
  const hidden = entries.length - shown.length;
  return [...head, ...shown, ...(hidden > 0 ? [`- Not listed: ${hidden} more`] : []), ...tail].join(
    "\n",
  );
}
