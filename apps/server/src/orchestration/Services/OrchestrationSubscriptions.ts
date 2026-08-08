import {
  OrchestrationGetSnapshotError,
  type OrchestrationEvent,
  type OrchestrationShellStreamEvent,
  type OrchestrationShellStreamItem,
  type OrchestrationSubscribeShellInput,
  type OrchestrationSubscribeThreadInput,
  type OrchestrationThreadStreamItem,
  type ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { projectActivityEvent, projectThreadDetailSnapshot } from "../ActivityPayloadProjection.ts";
import { OrchestrationEngineService } from "./OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./ProjectionSnapshotQuery.ts";

const RESUME_MAX_GAP = 1_000;
const LIVE_BUFFER_CAPACITY = 1_024;
const COALESCE_WINDOW = Duration.millis(50);
const COALESCE_MAX_CHUNK = 512;

function shellItemSequence(item: OrchestrationShellStreamItem): number | undefined {
  switch (item.kind) {
    case "snapshot":
      return item.snapshot.snapshotSequence;
    case "synchronized":
      return undefined;
    default:
      return item.sequence;
  }
}

function threadItemSequence(item: OrchestrationThreadStreamItem): number | undefined {
  switch (item.kind) {
    case "snapshot":
      return item.snapshot.snapshotSequence;
    case "event":
      return item.event.sequence;
    case "synchronized":
      return undefined;
  }
}

function keepMonotonic<A, E, R>(
  stream: Stream.Stream<A, E, R>,
  initialSequence: number,
  sequenceOf: (item: A) => number | undefined,
): Stream.Stream<A, E, R> {
  return stream.pipe(
    Stream.mapAccum(
      () => initialSequence,
      (lastSequence, item) => {
        const sequence = sequenceOf(item);
        if (sequence === undefined) {
          return [lastSequence, [item]] as const;
        }
        return sequence > lastSequence
          ? ([sequence, [item]] as const)
          : ([lastSequence, []] as const);
      },
    ),
  );
}

export function isThreadDetailEvent(event: OrchestrationEvent) {
  return (
    event.type === "thread.message-sent" ||
    event.type === "thread.proposed-plan-upserted" ||
    event.type === "thread.activity-appended" ||
    event.type === "thread.turn-diff-completed" ||
    event.type === "thread.reverted" ||
    event.type === "thread.session-set"
  );
}

export interface OrchestrationSubscriptionsShape {
  readonly subscribeShell: (
    input: OrchestrationSubscribeShellInput,
  ) => Effect.Effect<
    Stream.Stream<OrchestrationShellStreamItem, OrchestrationGetSnapshotError>,
    OrchestrationGetSnapshotError,
    Scope.Scope
  >;
  readonly subscribeThread: (
    input: OrchestrationSubscribeThreadInput,
  ) => Effect.Effect<
    Stream.Stream<OrchestrationThreadStreamItem, OrchestrationGetSnapshotError>,
    OrchestrationGetSnapshotError,
    Scope.Scope
  >;
}
export const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery;

  const retryRead = <A, E>(kind: string, id: string, read: Effect.Effect<A, E>) =>
    read.pipe(
      Effect.retry({ times: 1 }),
      Effect.map(Option.some),
      Effect.tapError((error) =>
        Effect.logWarning("orchestration shell projection refetch failed", { kind, id, error }),
      ),
      Effect.orElseSucceed(() => Option.none()),
    );
  const projectItem = (projectId: ProjectId, sequence: number) =>
    retryRead("project", projectId, snapshots.getProjectShellById(projectId)).pipe(
      Effect.map(
        (row): Option.Option<OrchestrationShellStreamEvent> =>
          Option.map(row, (project) =>
            Option.match(project, {
              onNone: (): OrchestrationShellStreamEvent => ({
                kind: "project-removed",
                sequence,
                projectId,
              }),
              onSome: (value): OrchestrationShellStreamEvent => ({
                kind: "project-upserted",
                sequence,
                project: value,
              }),
            }),
          ),
      ),
    );
  const threadItem = (threadId: ThreadId, sequence: number) =>
    retryRead("thread", threadId, snapshots.getThreadShellById(threadId)).pipe(
      Effect.map(
        (row): Option.Option<OrchestrationShellStreamEvent> =>
          Option.map(row, (thread) =>
            Option.match(thread, {
              onNone: (): OrchestrationShellStreamEvent => ({
                kind: "thread-removed",
                sequence,
                threadId,
              }),
              onSome: (value): OrchestrationShellStreamEvent => ({
                kind: "thread-upserted",
                sequence,
                thread: value,
              }),
            }),
          ),
      ),
    );
  const projectShellEvent = (
    event: OrchestrationEvent,
  ): Effect.Effect<Option.Option<OrchestrationShellStreamEvent>> => {
    switch (event.type) {
      case "project.created":
      case "project.meta-updated":
        return projectItem(event.payload.projectId, event.sequence);
      case "project.deleted":
        return Effect.succeed(
          Option.some({
            kind: "project-removed",
            sequence: event.sequence,
            projectId: event.payload.projectId,
          }),
        );
      case "thread.deleted":
      case "thread.archived":
        return Effect.succeed(
          Option.some({
            kind: "thread-removed",
            sequence: event.sequence,
            threadId: event.payload.threadId,
          }),
        );
      case "thread.unarchived":
        return threadItem(event.payload.threadId, event.sequence);
      default:
        return event.aggregateKind === "thread"
          ? threadItem(ThreadId.make(event.aggregateId), event.sequence)
          : Effect.succeed(Option.none());
    }
  };
  const coalesce = Effect.fn("OrchestrationSubscriptions.coalesce")(function* (
    events: ReadonlyArray<OrchestrationEvent>,
  ) {
    const latest = new Map<string, OrchestrationEvent>();
    for (const event of events) latest.set(`${event.aggregateKind}:${event.aggregateId}`, event);
    const ordered = Array.from(latest.values()).sort((a, b) => a.sequence - b.sequence);
    const items = yield* Effect.forEach(ordered, projectShellEvent, { concurrency: 8 });
    return items.flatMap((item) => (Option.isSome(item) ? [item.value] : []));
  });
  type ShellInput =
    | { readonly kind: "event"; readonly event: OrchestrationEvent }
    | { readonly kind: "synchronized" };
  const coalesceInputs = Effect.fn("OrchestrationSubscriptions.coalesceInputs")(function* (
    inputs: ReadonlyArray<ShellInput>,
  ) {
    const output: Array<OrchestrationShellStreamItem> = [];
    let pending: Array<OrchestrationEvent> = [];
    for (const input of inputs) {
      if (input.kind === "event") pending.push(input.event);
      else {
        output.push(...(yield* coalesce(pending)), { kind: "synchronized" });
        pending = [];
      }
    }
    output.push(...(yield* coalesce(pending)));
    return output;
  });
  const coalescedEvents = <E, R>(stream: Stream.Stream<OrchestrationEvent, E, R>) =>
    stream.pipe(
      Stream.groupedWithin(COALESCE_MAX_CHUNK, COALESCE_WINDOW),
      Stream.mapEffect(coalesce),
      Stream.flatMap(Stream.fromIterable),
    );
  const coalescedInputs = <E, R>(stream: Stream.Stream<ShellInput, E, R>) =>
    stream.pipe(
      Stream.groupedWithin(COALESCE_MAX_CHUNK, COALESCE_WINDOW),
      Stream.mapEffect(coalesceInputs),
      Stream.flatMap(Stream.fromIterable),
    );
  const offer = <A>(queue: Queue.Queue<A>, value: A, streamKind: "shell" | "thread") =>
    Queue.offer(queue, value).pipe(
      Effect.flatMap((accepted) =>
        accepted
          ? Effect.void
          : Effect.logWarning("orchestration subscription terminated a slow consumer", {
              streamKind,
              bufferCapacity: LIVE_BUFFER_CAPACITY,
            }).pipe(Effect.andThen(Queue.shutdown(queue))),
      ),
    );
  const shellSnapshot = snapshots.getShellSnapshot().pipe(
    Effect.mapError(
      (cause) =>
        new OrchestrationGetSnapshotError({
          message: "Failed to load orchestration shell snapshot",
          cause,
        }),
    ),
  );

  const subscribeShell = Effect.fn("OrchestrationSubscriptions.subscribeShell")(function* (
    input: OrchestrationSubscribeShellInput,
  ) {
    const queue = yield* Queue.dropping<ShellInput>(LIVE_BUFFER_CAPACITY);
    yield* engine.streamDomainEvents.pipe(
      Stream.runForEach((event) => offer(queue, { kind: "event", event }, "shell")),
      Effect.forkScoped({ startImmediately: true }),
    );
    const live = coalescedInputs(Stream.fromQueue(queue));
    const tail =
      input.requestCompletionMarker === true
        ? Stream.concat(
            Stream.fromEffect(
              offer(queue, { kind: "synchronized" }, "shell").pipe(
                Effect.andThen(Queue.takeAll(queue)),
                Effect.flatMap(coalesceInputs),
              ),
            ).pipe(Stream.flatMap(Stream.fromIterable)),
            live,
          )
        : live;
    if (input.afterSequence !== undefined) {
      const head = yield* engine.latestSequence;
      const gap = head - input.afterSequence;
      if (gap < 0 || gap > RESUME_MAX_GAP) {
        return keepMonotonic(
          Stream.concat(
            Stream.make({ kind: "snapshot" as const, snapshot: yield* shellSnapshot }),
            tail,
          ),
          -1,
          shellItemSequence,
        );
      }
      const replay = coalescedEvents(engine.readEvents(input.afterSequence, gap)).pipe(
        Stream.mapError(
          (cause) =>
            new OrchestrationGetSnapshotError({
              message: "Failed to replay orchestration shell events",
              cause,
            }),
        ),
      );
      return keepMonotonic(Stream.concat(replay, tail), input.afterSequence, shellItemSequence);
    }
    return keepMonotonic(
      Stream.concat(
        Stream.make({ kind: "snapshot" as const, snapshot: yield* shellSnapshot }),
        tail,
      ),
      -1,
      shellItemSequence,
    );
  });

  const subscribeThread = Effect.fn("OrchestrationSubscriptions.subscribeThread")(function* (
    input: OrchestrationSubscribeThreadInput,
  ) {
    const matches = (event: OrchestrationEvent) =>
      event.aggregateKind === "thread" &&
      event.aggregateId === input.threadId &&
      isThreadDetailEvent(event);
    const queue = yield* Queue.dropping<OrchestrationThreadStreamItem>(LIVE_BUFFER_CAPACITY);
    yield* engine.streamDomainEvents.pipe(
      Stream.filter(matches),
      Stream.map((event) => ({ kind: "event" as const, event: projectActivityEvent(event) })),
      Stream.runForEach((item) => offer(queue, item, "thread")),
      Effect.forkScoped({ startImmediately: true }),
    );
    const live = Stream.fromQueue(queue);
    const tail =
      input.requestCompletionMarker === true
        ? Stream.concat(
            Stream.fromEffect(offer(queue, { kind: "synchronized" }, "thread")).pipe(Stream.drain),
            live,
          )
        : live;
    const snapshot = snapshots
      .getThreadDetailSnapshot(
        input.threadId,
        input.turnLimit === undefined ? undefined : { turnLimit: input.turnLimit },
      )
      .pipe(
        Effect.mapError(
          (cause) =>
            new OrchestrationGetSnapshotError({
              message: `Failed to load thread ${input.threadId}`,
              cause,
            }),
        ),
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.fail(
                new OrchestrationGetSnapshotError({
                  message: `Thread ${input.threadId} was not found`,
                  cause: input.threadId,
                }),
              ),
            onSome: (value) => Effect.succeed(projectThreadDetailSnapshot(value)),
          }),
        ),
      );
    if (input.afterSequence !== undefined) {
      const head = yield* engine.latestSequence;
      const gap = head - input.afterSequence;
      if (gap < 0 || gap > RESUME_MAX_GAP) {
        return keepMonotonic(
          Stream.concat(
            Stream.make({ kind: "snapshot" as const, snapshot: yield* snapshot }),
            tail,
          ),
          -1,
          threadItemSequence,
        );
      }
      return keepMonotonic(
        Stream.concat(
          engine.readEvents(input.afterSequence, gap).pipe(
            Stream.filter(matches),
            Stream.map((event) => ({ kind: "event" as const, event: projectActivityEvent(event) })),
            Stream.mapError(
              (cause) =>
                new OrchestrationGetSnapshotError({
                  message: `Failed to replay thread ${input.threadId} events`,
                  cause,
                }),
            ),
          ),
          tail,
        ),
        input.afterSequence,
        threadItemSequence,
      );
    }
    return keepMonotonic(
      Stream.concat(Stream.make({ kind: "snapshot" as const, snapshot: yield* snapshot }), tail),
      -1,
      threadItemSequence,
    );
  });
  return { subscribeShell, subscribeThread } satisfies OrchestrationSubscriptionsShape;
});
