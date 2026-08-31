import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect, it } from "vite-plus/test";

import * as ServerSettings from "../../../serverSettings.ts";
import * as TerminalShell from "../../../terminal/ShellPolicy.ts";
import { layer } from "./ShellPolicy.ts";

describe("downstream terminal shell policy", () => {
    it("resolves the latest configured shell through the core interface", async () => {
        const program = Effect.gen(function* () {
            const policy = yield* TerminalShell.TerminalShellPolicy;
            return yield* policy.resolve;
        }).pipe(
            Effect.provide(layer.pipe(Layer.provide(ServerSettings.layerTest({ terminalShellPath: "/bin/fish" })))),
        );

        await expect(Effect.runPromise(program)).resolves.toBe("/bin/fish");
    });
});
