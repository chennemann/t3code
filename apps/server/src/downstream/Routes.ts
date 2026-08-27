import {
  AuthOrchestrationReadScope,
  EnvironmentInternalError,
  EnvironmentHttpApi,
  EnvironmentResourceNotFoundError,
  OrchestrationGetSnapshotError,
  OrchestrationShellStreamItem,
  type OrchestrationSubscribeShellInput,
  OrchestrationThreadStreamItem,
  PORTABLE_CLIENT_PROTOCOL_VERSION,
  PortableOrchestrationStreamQuery,
  ThreadId,
} from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerRespondable,
  HttpServerResponse,
} from "effect/unstable/http";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import {
  annotateEnvironmentRequest,
  failEnvironmentAuthInvalid,
  failEnvironmentInternal,
  failEnvironmentInvalidRequest,
  failEnvironmentNotFound,
  failEnvironmentScopeRequired,
  requireEnvironmentScope,
} from "../auth/http.ts";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ProviderRegistry from "../provider/Services/ProviderRegistry.ts";
import { make as makeOrchestrationSubscriptions } from "./orchestration/Subscriptions.ts";

export const environmentClientHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "environmentClient",
  Effect.fnUntraced(function* (handlers) {
    const environment = yield* ServerEnvironment.ServerEnvironment;
    const auth = yield* EnvironmentAuth.EnvironmentAuth;
    const providers = yield* ProviderRegistry.ProviderRegistry;
    return handlers.handle(
      "clientConfig",
      Effect.fn("environment.clientConfig")(function* (args) {
        yield* annotateEnvironmentRequest(args.endpoint.name);
        yield* requireEnvironmentScope(AuthOrchestrationReadScope);
        return yield* Effect.all({
          environment: environment.getDescriptor,
          auth: auth.getDescriptor(),
          providers: providers.getProviders,
          shellResumeCompletionMarker: Effect.succeed(true),
          threadResumeCompletionMarker: Effect.succeed(true),
          protocolVersion: Effect.succeed(PORTABLE_CLIENT_PROTOCOL_VERSION),
        });
      }),
    );
  }),
);

const streamHeaders = {
  "cache-control": "no-cache, no-store, no-transform",
  connection: "keep-alive",
  "content-type": "text/event-stream; charset=utf-8",
  "x-accel-buffering": "no",
} as const;
const decodeThreadId = Schema.decodeUnknownEffect(ThreadId);
const decodeQuery = Schema.decodeUnknownEffect(PortableOrchestrationStreamQuery);
const toSubscriptionQuery = (
  query: PortableOrchestrationStreamQuery,
): OrchestrationSubscribeShellInput => ({
  afterSequence: query.afterSequence,
  ...(query.requestCompletionMarker === undefined
    ? {}
    : { requestCompletionMarker: query.requestCompletionMarker }),
});
const parseQuery = Effect.fn("environment.orchestration.parseStreamQuery")(function* (
  request: HttpServerRequest.HttpServerRequest,
) {
  const url = HttpServerRequest.toURL(request);
  if (Option.isNone(url)) return yield* failEnvironmentInvalidRequest("invalid_stream_query");
  const after = url.value.searchParams.get("afterSequence");
  const marker = url.value.searchParams.get("requestCompletionMarker");
  return yield* decodeQuery({
    ...(after === null || after.trim().length === 0 ? {} : { afterSequence: Number(after) }),
    ...(marker === null
      ? {}
      : {
          requestCompletionMarker: marker === "true" ? true : marker === "false" ? false : marker,
        }),
  }).pipe(Effect.catch(() => failEnvironmentInvalidRequest("invalid_stream_query")));
});
const authenticate = Effect.fn("environment.orchestration.authenticateStreamRequest")(function* (
  request: HttpServerRequest.HttpServerRequest,
) {
  const auth = yield* EnvironmentAuth.EnvironmentAuth;
  const session = yield* auth.authenticateHttpRequest(request).pipe(
    Effect.catchIf(EnvironmentAuth.isServerAuthCredentialError, (error) =>
      failEnvironmentAuthInvalid(EnvironmentAuth.serverAuthCredentialReason(error)),
    ),
    Effect.catchIf(EnvironmentAuth.isServerAuthInternalError, (error) =>
      failEnvironmentInternal("internal_error", error),
    ),
  );
  if (!session.scopes.includes(AuthOrchestrationReadScope)) {
    return yield* failEnvironmentScopeRequired(AuthOrchestrationReadScope);
  }
});
const failThreadSubscription = Effect.fn("environment.orchestration.failThreadSubscription")(
  function* (
    cause: OrchestrationGetSnapshotError,
    threadId: ThreadId,
  ): Effect.fn.Return<never, EnvironmentResourceNotFoundError | EnvironmentInternalError> {
    if (cause.cause === threadId) {
      return yield* failEnvironmentNotFound("thread_not_found");
    }
    return yield* failEnvironmentInternal("orchestration_thread_snapshot_failed", cause);
  },
);
const shellSequence = (item: OrchestrationShellStreamItem) =>
  item.kind === "snapshot"
    ? item.snapshot.snapshotSequence
    : item.kind === "synchronized"
      ? undefined
      : item.sequence;
const threadSequence = (item: OrchestrationThreadStreamItem) =>
  item.kind === "snapshot"
    ? item.snapshot.snapshotSequence
    : item.kind === "event"
      ? item.event.sequence
      : undefined;
const frame = <A>(item: A, sequence: number | undefined) =>
  `${sequence === undefined ? "" : `id: ${sequence}\n`}event: message\ndata: ${JSON.stringify(item)}\n\n`;
const response = <E>(stream: Stream.Stream<string, E, never>, streamKind: "shell" | "thread") =>
  HttpServerResponse.stream(
    stream.pipe(
      Stream.catchCause((cause) =>
        Stream.fromEffect(
          Effect.logWarning("portable orchestration SSE stream terminated", {
            streamKind,
            cause,
          }),
        ).pipe(Stream.drain),
      ),
      Stream.merge(
        Stream.fromEffect(
          Effect.sleep(Duration.seconds(10)).pipe(Effect.as(": keepalive\n\n")),
        ).pipe(Stream.forever),
        { haltStrategy: "left" },
      ),
      Stream.encodeText,
    ),
    { headers: streamHeaders },
  );
export const orchestrationSseRouteLayer = Layer.mergeAll(
  HttpRouter.add(
    "GET",
    "/api/orchestration/shell/stream",
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      yield* authenticate(request);
      const input = toSubscriptionQuery(yield* parseQuery(request));
      const subscriptions = yield* makeOrchestrationSubscriptions;
      const stream = yield* subscriptions
        .subscribeShell(input)
        .pipe(
          Effect.catch((cause) => failEnvironmentInternal("orchestration_snapshot_failed", cause)),
        );
      return response(stream.pipe(Stream.map((item) => frame(item, shellSequence(item)))), "shell");
    }).pipe(
      Effect.catchTags({
        EnvironmentRequestInvalidError: HttpServerRespondable.toResponse,
        EnvironmentAuthInvalidError: HttpServerRespondable.toResponse,
        EnvironmentScopeRequiredError: HttpServerRespondable.toResponse,
        EnvironmentInternalError: HttpServerRespondable.toResponse,
      }),
    ),
  ),
  HttpRouter.add(
    "GET",
    "/api/orchestration/threads/:threadId/stream",
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      yield* authenticate(request);
      const params = yield* HttpRouter.params;
      const threadId = yield* decodeThreadId(params.threadId).pipe(
        Effect.catch(() => failEnvironmentInvalidRequest("invalid_stream_query")),
      );
      const subscriptions = yield* makeOrchestrationSubscriptions;
      const query = toSubscriptionQuery(yield* parseQuery(request));
      const stream = yield* subscriptions
        .subscribeThread({ ...query, threadId })
        .pipe(Effect.catch((cause) => failThreadSubscription(cause, threadId)));
      return response(
        stream.pipe(Stream.map((item) => frame(item, threadSequence(item)))),
        "thread",
      );
    }).pipe(
      Effect.catchTags({
        EnvironmentRequestInvalidError: HttpServerRespondable.toResponse,
        EnvironmentAuthInvalidError: HttpServerRespondable.toResponse,
        EnvironmentScopeRequiredError: HttpServerRespondable.toResponse,
        EnvironmentResourceNotFoundError: HttpServerRespondable.toResponse,
        EnvironmentInternalError: HttpServerRespondable.toResponse,
      }),
    ),
  ),
);
