import * as Schema from "effect/Schema";
import * as OpenApi from "effect/unstable/httpapi/OpenApi";
import { describe, expect, it } from "vite-plus/test";

import clientConfig from "../../portable/v1/fixtures/client-config.json" with { type: "json" };
import commands from "../../portable/v1/fixtures/commands.json" with { type: "json" };
import shellItems from "../../portable/v1/fixtures/shell-stream-items.json" with { type: "json" };
import streamEvolutionCases from "../../portable/v1/fixtures/stream-evolution-cases.json" with {
  type: "json",
};
import threadItems from "../../portable/v1/fixtures/thread-stream-items.json" with { type: "json" };
import {
  EnvironmentClientConfig,
  PORTABLE_CLIENT_PROTOCOL_VERSION,
  PortableClientOpenApi,
  PortableOrchestrationStreamQuery,
} from "./portableClient.ts";
import {
  ClientOrchestrationCommand,
  OrchestrationShellStreamItem,
  OrchestrationThreadStreamItem,
} from "../orchestration.ts";

const decodePortableStreamQuery = Schema.decodeUnknownSync(PortableOrchestrationStreamQuery);
const decodeClientConfig = Schema.decodeUnknownSync(EnvironmentClientConfig);
const decodeCommands = Schema.decodeUnknownSync(Schema.Array(ClientOrchestrationCommand));
const decodeShellItems = Schema.decodeUnknownSync(Schema.Array(OrchestrationShellStreamItem));
const decodeThreadItems = Schema.decodeUnknownSync(Schema.Array(OrchestrationThreadStreamItem));

describe("portable client protocol v1", () => {
  it("publishes the complete portable HTTP surface with bearer-secured orchestration", () => {
    const document = OpenApi.fromApi(PortableClientOpenApi);

    expect(Object.keys(document.paths).sort()).toEqual([
      "/.well-known/t3/environment",
      "/api/auth/session",
      "/api/environment/client-config",
      "/api/orchestration/dispatch",
      "/api/orchestration/shell",
      "/api/orchestration/shell/stream",
      "/api/orchestration/threads/{threadId}",
      "/api/orchestration/threads/{threadId}/stream",
      "/oauth/token",
    ]);
    expect(document.components.securitySchemes?.portableBearer).toEqual({
      type: "http",
      scheme: "bearer",
      description: "Environment access token with the scopes required by the endpoint.",
    });
    expect(document.paths["/api/orchestration/shell/stream"]?.get?.security).toEqual([
      { portableBearer: [] },
    ]);
  });

  it("requires a non-negative sequence cursor for portable SSE resumption", () => {
    expect(() => decodePortableStreamQuery({})).toThrow();
    expect(() => decodePortableStreamQuery({ afterSequence: -1 })).toThrow();
    expect(decodePortableStreamQuery({ afterSequence: 0, requestCompletionMarker: true })).toEqual({
      afterSequence: 0,
      requestCompletionMarker: true,
    });
  });

  it("decodes every golden fixture without Effect RPC framing", () => {
    expect(decodeClientConfig(clientConfig).protocolVersion).toBe(PORTABLE_CLIENT_PROTOCOL_VERSION);
    expect(decodeCommands(commands)).toHaveLength(10);
    expect(decodeShellItems(shellItems)).toHaveLength(6);
    const decodedThreadItems = decodeThreadItems(threadItems);
    expect(decodedThreadItems.at(-1)).toEqual({ kind: "synchronized" });

    const unknownActivity = decodedThreadItems.find(
      (item) =>
        item.kind === "event" &&
        item.event.type === "thread.activity-appended" &&
        item.event.payload.activity.kind === "future.additive-activity",
    );
    expect(unknownActivity).toBeDefined();
    expect(JSON.stringify(threadItems)).not.toContain("orchestration.subscribeThread");
  });

  it("matches React Native stream evolution behavior", () => {
    expect(() =>
      decodeShellItems([streamEvolutionCases.knownShellItemWithAdditiveFields]),
    ).not.toThrow();
    expect(() =>
      decodeThreadItems([streamEvolutionCases.knownThreadItemWithAdditiveFields]),
    ).not.toThrow();

    expect(() => decodeShellItems([streamEvolutionCases.unknownShellItem])).toThrow();
    expect(() => decodeThreadItems([streamEvolutionCases.unknownThreadItem])).toThrow();
  });
});
