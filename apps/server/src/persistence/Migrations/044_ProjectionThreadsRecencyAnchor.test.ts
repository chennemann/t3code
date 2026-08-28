import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("044_ProjectionThreadsRecencyAnchor", (it) => {
  it.effect("backfills the latest user-message re-engagement after a 36-hour gap", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 43 });

      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode,
          branch, worktree_path, latest_turn_id, created_at, updated_at, archived_at,
          latest_user_message_at, pending_approval_count, pending_user_input_count,
          has_actionable_proposed_plan, deleted_at
        )
        VALUES
          ('continuous', 'project-1', 'Continuous', '{"provider":"codex","model":"gpt-5"}',
            'full-access', 'default', NULL, NULL, NULL, '2026-01-01T00:00:00.000Z',
            '2026-01-03T22:00:00.000Z', NULL, '2026-01-03T22:00:00.000Z', 0, 0, 0, NULL),
          ('resumed', 'project-1', 'Resumed', '{"provider":"codex","model":"gpt-5"}',
            'full-access', 'default', NULL, NULL, NULL, '2026-01-01T00:00:00.000Z',
            '2026-01-04T02:00:00.000Z', NULL, '2026-01-04T02:00:00.000Z', 0, 0, 0, NULL),
          ('empty', 'project-1', 'Empty', '{"provider":"codex","model":"gpt-5"}',
            'full-access', 'default', NULL, NULL, NULL, '2026-01-02T00:00:00.000Z',
            '2026-01-02T00:00:00.000Z', NULL, NULL, 0, 0, 0, NULL)
      `;

      yield* sql`
        INSERT INTO projection_thread_messages (
          message_id, thread_id, turn_id, role, text, attachments_json, is_streaming,
          created_at, updated_at
        )
        VALUES
          ('continuous-1', 'continuous', NULL, 'user', 'one', NULL, 0,
            '2026-01-01T01:00:00.000Z', '2026-01-01T01:00:00.000Z'),
          ('continuous-2', 'continuous', NULL, 'user', 'two', NULL, 0,
            '2026-01-02T12:00:00.000Z', '2026-01-02T12:00:00.000Z'),
          ('continuous-3', 'continuous', NULL, 'user', 'three', NULL, 0,
            '2026-01-03T23:00:00.000Z', '2026-01-03T23:00:00.000Z'),
          ('resumed-1', 'resumed', NULL, 'user', 'pause', NULL, 0,
            '2026-01-01T01:00:00.000Z', '2026-01-01T01:00:00.000Z'),
          ('resumed-assistant', 'resumed', NULL, 'assistant', 'work', NULL, 0,
            '2026-01-03T00:00:00.000Z', '2026-01-03T00:00:00.000Z'),
          ('resumed-2', 'resumed', NULL, 'user', 'continue', NULL, 0,
            '2026-01-02T13:00:00.000Z', '2026-01-02T13:00:00.000Z'),
          ('resumed-3', 'resumed', NULL, 'user', 'continue again', NULL, 0,
            '2026-01-04T01:00:00.000Z', '2026-01-04T01:00:00.000Z')
      `;

      yield* runMigrations({ toMigrationInclusive: 44 });

      const rows = yield* sql<{
        readonly threadId: string;
        readonly recencyAnchorAt: string;
      }>`
        SELECT thread_id AS "threadId", recency_anchor_at AS "recencyAnchorAt"
        FROM projection_threads
        ORDER BY thread_id
      `;
      assert.deepEqual(rows, [
        { threadId: "continuous", recencyAnchorAt: "2026-01-01T00:00:00.000Z" },
        { threadId: "empty", recencyAnchorAt: "2026-01-02T00:00:00.000Z" },
        { threadId: "resumed", recencyAnchorAt: "2026-01-04T01:00:00.000Z" },
      ]);
    }),
  );
});
