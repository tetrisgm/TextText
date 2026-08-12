import pg from "pg";

/**
 * Open the same migration surface against local Postgres or production Neon.
 * The returned function supports both tagged SQL and the legacy `.query(text)`
 * calls used by older migration scripts.
 */
export async function connectMigrationDatabase(databaseUrl) {
  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes(".neon.tech")
      ? { rejectUnauthorized: true }
      : undefined,
  });
  await client.connect();

  const sql = async (strings, ...values) => {
    let text = strings[0];
    for (let index = 0; index < values.length; index += 1) {
      text += `$${index + 1}${strings[index + 1]}`;
    }
    const result = await client.query(text, values);
    return result.rows;
  };
  sql.query = async (text, values = []) => {
    const result = await client.query(text, values);
    return result.rows;
  };
  sql.close = () => client.end();
  return sql;
}
