import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;

    if (!columns.some((column) => column.name === "recency_anchor_at")) {
        yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN recency_anchor_at TEXT
    `;
    }

    yield* sql`
    WITH ordered_user_messages AS (
      SELECT
        thread_id,
        created_at,
        LAG(created_at) OVER (
          PARTITION BY thread_id
          ORDER BY created_at ASC, message_id ASC
        ) AS previous_user_message_at
      FROM projection_thread_messages
      WHERE role = 'user'
    ),
    recency_anchors AS (
      SELECT thread_id, MAX(created_at) AS recency_anchor_at
      FROM ordered_user_messages
      WHERE previous_user_message_at IS NOT NULL
        AND julianday(created_at) - julianday(previous_user_message_at) >= 1.5
      GROUP BY thread_id
    )
    UPDATE projection_threads
    SET recency_anchor_at = COALESCE(
      (
        SELECT recency_anchors.recency_anchor_at
        FROM recency_anchors
        WHERE recency_anchors.thread_id = projection_threads.thread_id
      ),
      projection_threads.created_at
    )
  `;
});
