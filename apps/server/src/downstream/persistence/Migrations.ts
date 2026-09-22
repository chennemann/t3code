import * as Migrator from "effect/unstable/sql/Migrator";

import Migration0001 from "./Migrations/001_Initial.ts";

export const migrationEntries = [[1, "Initial", Migration0001]] as const;

const run = Migrator.make({});
const loader = Migrator.fromRecord(
  Object.fromEntries(migrationEntries.map(([id, name, migration]) => [`${id}_${name}`, migration])),
);

export const runMigrations = run({ loader });
