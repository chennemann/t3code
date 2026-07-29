import * as Schema from "effect/Schema";
import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint";
import * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup";
import * as HttpApiMiddleware from "effect/unstable/httpapi/HttpApiMiddleware";
import * as HttpApiSchema from "effect/unstable/httpapi/HttpApiSchema";
import * as HttpApiSecurity from "effect/unstable/httpapi/HttpApiSecurity";
import * as OpenApi from "effect/unstable/httpapi/OpenApi";

import {
  AuthAccessTokenResult,
  AuthSessionState,
  AuthTokenExchangeRequest,
  ServerAuthDescriptor,
} from "./auth.ts";
import { NonNegativeInt, ThreadId } from "./baseSchemas.ts";
import { ExecutionEnvironmentDescriptor } from "./environment.ts";
import {
  ClientOrchestrationCommand,
  DispatchResult,
  OrchestrationShellSnapshot,
  OrchestrationShellStreamItem,
  OrchestrationThreadDetailSnapshot,
  OrchestrationThreadStreamItem,
} from "./orchestration.ts";
import { ServerProviders } from "./server.ts";

export const PORTABLE_CLIENT_PROTOCOL_VERSION = 1 as const;
export const PortableClientProtocolVersion = Schema.Literal(PORTABLE_CLIENT_PROTOCOL_VERSION);

export const EnvironmentClientConfig = Schema.Struct({
  environment: ExecutionEnvironmentDescriptor,
  auth: ServerAuthDescriptor,
  providers: ServerProviders,
  shellResumeCompletionMarker: Schema.Boolean,
  threadResumeCompletionMarker: Schema.Boolean,
  protocolVersion: PortableClientProtocolVersion,
});
export type EnvironmentClientConfig = typeof EnvironmentClientConfig.Type;

/**
 * A portable stream always resumes from a snapshot cursor. Omitting the cursor
 * is invalid so native clients cannot accidentally request an unbounded initial
 * stream instead of using the explicit snapshot endpoints.
 */
export const PortableOrchestrationStreamQuery = Schema.Struct({
  afterSequence: NonNegativeInt,
  requestCompletionMarker: Schema.optional(Schema.Boolean),
});
export type PortableOrchestrationStreamQuery = typeof PortableOrchestrationStreamQuery.Type;

export const PortableShellSseEvent = Schema.Struct({
  id: Schema.optionalKey(Schema.String),
  event: Schema.Literal("message"),
  data: Schema.fromJsonString(OrchestrationShellStreamItem),
});
export type PortableShellSseEvent = typeof PortableShellSseEvent.Type;

export const PortableThreadSseEvent = Schema.Struct({
  id: Schema.optionalKey(Schema.String),
  event: Schema.Literal("message"),
  data: Schema.fromJsonString(OrchestrationThreadStreamItem),
});
export type PortableThreadSseEvent = typeof PortableThreadSseEvent.Type;

const OptionalBearerHeaders = Schema.Struct({
  authorization: Schema.optionalKey(Schema.String),
});
const OptionalDpopHeaders = Schema.Struct({
  dpop: Schema.optionalKey(Schema.String),
});

const PortableBearerAuthorization = HttpApiSecurity.http({ scheme: "bearer" }).pipe(
  HttpApiSecurity.annotate(
    OpenApi.Description,
    "Environment access token with the scopes required by the endpoint.",
  ),
);

class PortableBearerAuth extends HttpApiMiddleware.Service<PortableBearerAuth>()(
  "PortableBearerAuth",
  {
    security: { portableBearer: PortableBearerAuthorization },
  },
) {}

const PortableMetadataOpenApiGroup = HttpApiGroup.make("portable-metadata").add(
  HttpApiEndpoint.get("environmentDescriptor", "/.well-known/t3/environment", {
    success: ExecutionEnvironmentDescriptor,
  }),
);

const PortableAuthOpenApiGroup = HttpApiGroup.make("portable-auth")
  .add(
    HttpApiEndpoint.get("authSession", "/api/auth/session", {
      headers: OptionalBearerHeaders,
      success: AuthSessionState,
    }),
  )
  .add(
    HttpApiEndpoint.post("tokenExchange", "/oauth/token", {
      headers: OptionalDpopHeaders,
      payload: AuthTokenExchangeRequest,
      success: AuthAccessTokenResult,
    }),
  );

export const PortableClientOpenApiGroup = HttpApiGroup.make("portable-client")
  .add(
    HttpApiEndpoint.get("clientConfig", "/api/environment/client-config", {
      success: EnvironmentClientConfig,
    }).middleware(PortableBearerAuth),
  )
  .add(
    HttpApiEndpoint.get("shellSnapshot", "/api/orchestration/shell", {
      success: OrchestrationShellSnapshot,
    }).middleware(PortableBearerAuth),
  )
  .add(
    HttpApiEndpoint.get("threadSnapshot", "/api/orchestration/threads/:threadId", {
      params: Schema.Struct({ threadId: ThreadId }),
      success: OrchestrationThreadDetailSnapshot,
    }).middleware(PortableBearerAuth),
  )
  .add(
    HttpApiEndpoint.post("dispatch", "/api/orchestration/dispatch", {
      payload: ClientOrchestrationCommand,
      success: DispatchResult,
    }).middleware(PortableBearerAuth),
  )
  .add(
    HttpApiEndpoint.get("shellStream", "/api/orchestration/shell/stream", {
      query: PortableOrchestrationStreamQuery,
      success: HttpApiSchema.StreamSse({ events: PortableShellSseEvent }),
    }).middleware(PortableBearerAuth),
  )
  .add(
    HttpApiEndpoint.get("threadStream", "/api/orchestration/threads/:threadId/stream", {
      params: Schema.Struct({ threadId: ThreadId }),
      query: PortableOrchestrationStreamQuery,
      success: HttpApiSchema.StreamSse({ events: PortableThreadSseEvent }),
    }).middleware(PortableBearerAuth),
  )
  .annotate(
    OpenApi.Description,
    "Bearer-authenticated provider-neutral snapshots, commands, and SSE streams.",
  );

export class PortableClientOpenApi extends HttpApi.make("t3-portable-client")
  .add(PortableMetadataOpenApiGroup)
  .add(PortableAuthOpenApiGroup)
  .add(PortableClientOpenApiGroup)
  .annotate(OpenApi.Title, "T3 Portable Client Protocol")
  .annotate(OpenApi.Version, String(PORTABLE_CLIENT_PROTOCOL_VERSION))
  .annotate(
    OpenApi.Description,
    "Portable protocol v1: JSON over HTTP plus resumable Server-Sent Events.",
  ) {}
