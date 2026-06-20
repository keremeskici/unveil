import { readFile } from "node:fs/promises";
import { Client } from "pg";

const MIGRATION_PATH = "drizzle/0008_call_message_kind.sql";

function databaseUrl() {
  const url =
    process.env.DATABASE_URL_UNPOOLED ??
    process.env.DATABASE_DIRECT_URL ??
    process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL_UNPOOLED, DATABASE_DIRECT_URL, or DATABASE_URL must be set",
    );
  }
  return url;
}

async function migrationStatements() {
  const sql = await readFile(MIGRATION_PATH, "utf8");
  return sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function main() {
  const statements = await migrationStatements();
  const client = new Client({ connectionString: databaseUrl() });
  await client.connect();

  try {
    // ALTER TYPE ... ADD VALUE cannot run inside a transaction block, so each
    // statement is issued on its own (the pg client auto-commits per query).
    for (const statement of statements) {
      await client.query(statement);
    }
    console.log(`Applied ${MIGRATION_PATH}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
