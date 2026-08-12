import { describe, expect, it } from "vite-plus/test";

import { buildTodoDraftPrompt } from "./todos";

describe("buildTodoDraftPrompt", () => {
    it("uses the title by itself when the to-do has no notes", () => {
        expect(buildTodoDraftPrompt({ title: "Ship it", notes: "" })).toBe("Ship it");
    });

    it("keeps planning fields out of the draft prompt", () => {
        const todo = {
            title: "Ship it",
            notes: "Remember the release notes",
            specification: "Internal specification",
            context: "Internal context",
            plan: "Internal plan",
        };

        expect(buildTodoDraftPrompt(todo)).toBe("Ship it\n\nRemember the release notes");
    });
});
