import { describe, expect, it } from "vite-plus/test";
import { unexpectedIntegrationFiles } from "./check-downstream.ts";

const policy = {
  ownedDirectories: ["apps/server/src/downstream"],
  ownedFiles: ["scripts/check-downstream.ts"],
  upstreamFiles: ["apps/server/src/server.ts"],
};

describe("downstream integration policy", () => {
  it("allows feature modules and reviewed integration points on either platform", () => {
    expect(
      unexpectedIntegrationFiles(
        [
          "apps\\server\\src\\downstream\\features\\planning.ts",
          "apps/server/src/server.ts",
          "scripts/check-downstream.ts",
        ],
        policy,
      ),
    ).toEqual([]);
  });

  it("rejects new core edits, migration registry edits, and prefix lookalikes", () => {
    expect(
      unexpectedIntegrationFiles(
        [
          "apps/server/src/orchestration/decider.ts",
          "apps/server/src/persistence/Migrations.ts",
          "apps/server/src/downstream-other/file.ts",
        ],
        policy,
      ),
    ).toEqual([
      "apps/server/src/orchestration/decider.ts",
      "apps/server/src/persistence/Migrations.ts",
      "apps/server/src/downstream-other/file.ts",
    ]);
  });
});
