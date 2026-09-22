import type { OrchestrationEvent, OrchestrationReadModel } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { ProjectionRepositoryError } from "../persistence/Errors.ts";
import { WorkPlanningStore } from "./features/workPlanning/Store.ts";

type DownstreamReadModelFragment = Omit<
  Partial<OrchestrationReadModel>,
  "snapshotSequence" | "projects" | "threads" | "updatedAt"
>;

export const projectorNames = {
  todos: "projection.todos",
} as const;

export interface DownstreamProjectionShape {
  readonly projectors: ReadonlyArray<{
    readonly name: (typeof projectorNames)[keyof typeof projectorNames];
    readonly apply: (event: OrchestrationEvent) => Effect.Effect<void, ProjectionRepositoryError>;
  }>;
  readonly readModelContribution: Effect.Effect<
    {
      readonly fragment: DownstreamReadModelFragment;
      readonly updatedAt: string | null;
    },
    ProjectionRepositoryError
  >;
}

export class DownstreamProjection extends Context.Service<
  DownstreamProjection,
  DownstreamProjectionShape
>()("t3/downstream/Projection/DownstreamProjection") {}

export const layer = Layer.effect(
  DownstreamProjection,
  Effect.map(WorkPlanningStore, (workPlanning) =>
    DownstreamProjection.of({
      projectors: [
        {
          name: projectorNames.todos,
          apply: workPlanning.applyEvent,
        },
      ],
      readModelContribution: workPlanning.list.pipe(
        Effect.map((todos) => ({
          fragment: { todos },
          updatedAt: todos.reduce<string | null>(
            (latest, todo) =>
              latest === null || todo.updatedAt > latest ? todo.updatedAt : latest,
            null,
          ),
        })),
      ),
    }),
  ),
);
