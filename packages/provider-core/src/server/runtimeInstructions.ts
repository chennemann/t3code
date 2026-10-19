import { DEFAULT_PULL_REQUEST_LINKING_INSTRUCTIONS } from "@t3tools/contracts";

export function buildPullRequestLinkingInstructions(
  instructions = DEFAULT_PULL_REQUEST_LINKING_INSTRUCTIONS,
): string {
  return instructions.trim()
    ? `<pull_request_linking>\n${instructions.trim()}\n</pull_request_linking>`
    : "";
}

/** Omit model and effort when the harness manages them dynamically. */
export function buildRuntimeInstructions(runtime: {
  readonly harness: string;
  readonly pullRequestLinkingInstructions?: string | undefined;
  readonly model?: string | undefined;
  readonly modelName?: string | undefined;
  readonly reasoningEffort?: string | undefined;
  /** False when the session's system prompt already carries the linking instructions. */
  readonly pullRequestLinking?: boolean;
}): string {
  const harness = toSingleLine(runtime.harness);
  const model = toSingleLine(runtime.model ?? "");
  const modelName = toSingleLine(runtime.modelName ?? "");
  const effort = toSingleLine(runtime.reasoningEffort ?? "");
  const modelLabel =
    modelName && modelName !== model ? `${modelName} (model slug: ${model})` : model;
  const modelInfo = model && model !== "auto" && model !== "default" ? `, as ${modelLabel}` : "";
  const effortInfo = effort ? ` with ${effort} reasoning effort` : "";
  const runtimeInfo = `<runtime_info>In case you're asked: you are running in T3 Code through the ${harness} harness${modelInfo}${effortInfo}. No need to mention this otherwise. You can embed images, video, and audio in your response using Markdown image syntax with absolute file paths. Link any other file you produce using its absolute path so the user can open it in T3 Code's files viewer.</runtime_info>`;
  const linking = buildPullRequestLinkingInstructions(runtime.pullRequestLinkingInstructions);
  return runtime.pullRequestLinking === false || !linking
    ? runtimeInfo
    : `${runtimeInfo}\n\n${linking}`;
}

function toSingleLine(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}
