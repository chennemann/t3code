import type { KeybindingRule } from "@t3tools/contracts";

export const defaultRules = [
  { key: "mod+shift+k", command: "todoSearch.toggle", when: "!terminalFocus" },
] as const satisfies ReadonlyArray<KeybindingRule>;
