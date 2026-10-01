// Separate file-vault item/folder grants from legacy post/folder collaborators.
// Additive and idempotent; the file vault's TextPack identity is scoped by its
// workspace, and directory signatures fence a replaced folder path.
import { connectMigrationDatabase } from "./lib/postgres-migration.mjs";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const sql = await connectMigrationDatabase(process.env.DATABASE_URL);
try {
  await sql`
    CREATE TABLE IF NOT EXISTS vault_grants (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id uuid NOT NULL REFERENCES blogs(id) ON DELETE CASCADE,
      scope_type text NOT NULL CHECK (scope_type IN ('item', 'folder')),
      scope_key text NOT NULL,
      folder_signature text,
      invited_email text NOT NULL,
      user_id uuid REFERENCES users(id) ON DELETE CASCADE,
      role text NOT NULL CHECK (role IN ('viewer', 'commenter', 'editor')),
      invited_by_id uuid REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamp NOT NULL DEFAULT now(),
      revoked_at timestamp,
      CONSTRAINT vault_grants_folder_signature_check CHECK (
        (scope_type = 'item' AND folder_signature IS NULL) OR
        (scope_type = 'folder' AND folder_signature IS NOT NULL)
      )
    )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS vault_grants_active_email_idx
    ON vault_grants (workspace_id, scope_type, scope_key, invited_email)
    WHERE revoked_at IS NULL
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS vault_grants_user_active_idx
    ON vault_grants (user_id, workspace_id)
    WHERE revoked_at IS NULL AND user_id IS NOT NULL
  `;
} finally {
  await sql.close();
}
