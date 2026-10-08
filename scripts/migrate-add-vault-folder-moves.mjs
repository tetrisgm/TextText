import { connectMigrationDatabase } from "./lib/postgres-migration.mjs";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const sql = await connectMigrationDatabase(process.env.DATABASE_URL);
try {
  await sql`CREATE TABLE IF NOT EXISTS vault_folder_moves (
    workspace_id uuid NOT NULL REFERENCES blogs(id) ON DELETE CASCADE,
    operation_id text NOT NULL,
    request_hash text NOT NULL,
    actor_user_id uuid NOT NULL REFERENCES users(id),
    plan jsonb NOT NULL,
    status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'applied', 'aborted')),
    created_at timestamp NOT NULL DEFAULT now(),
    completed_at timestamp,
    PRIMARY KEY (workspace_id, operation_id)
  )`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS vault_folder_moves_reserved_idx ON vault_folder_moves(workspace_id) WHERE status = 'reserved'`;
} finally { await sql.close(); }
