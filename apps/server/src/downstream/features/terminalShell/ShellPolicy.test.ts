import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { assert, describe, it } from "@effect/vitest";

import * as ServerSettings from "../../../serverSettings.ts";
import * as TerminalShell from "../../../terminal/ShellPolicy.ts";
import { layer } from "./ShellPolicy.ts";

describe("downstream terminal shell policy", () => {
  it.effect("resolves the configured shell through the core interface", () =>
    Effect.gen(function* () {
      const policy = yield* TerminalShell.TerminalShellPolicy;
      assert.equal(yield* policy.resolve, "/bin/fish");
    }).pipe(
      Effect.provide(
        layer.pipe(Layer.provide(ServerSettings.layerTest({ terminalShellPath: "/bin/fish" }))),
      ),
    ),
  );
});
