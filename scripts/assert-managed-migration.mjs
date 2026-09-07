// Test helper for the two scratch-cluster suites only. All identifiers below
// come from their fixed fixtures; this never connects to a hosted database.
import assert from "node:assert/strict";

export async function assertManagedMigration({ admin, connect, migration, operator, owner, runtime, schema }) {
  for (const name of [operator, owner, runtime, schema]) assert.match(name, /^[a-z_]+$/u);
  await admin.query(`create role ${operator} login nosuperuser nocreatedb createrole noinherit nobypassrls`);
  const client = await connect(operator);
  const noSchema = async () => assert.equal((await admin.query("select to_regnamespace($1) as name", [schema])).rows[0].name, null);
  const restoredSession = async () => assert.deepEqual((await client.query(
    "select current_user as actor, current_setting('createrole_self_grant') as self_grant")).rows[0],
  { actor: operator, self_grant: "inherit" });
  try {
    // A caller's session defaults must survive both rollback and commit. The
    // migration must override inherited creation privileges only locally.
    await client.query("set createrole_self_grant = 'inherit'");
    await assert.rejects(client.query(migration), (error) => error.code === "42501");
    await client.query("rollback");
    await noSchema(); await restoredSession();
    assert.equal((await admin.query("select count(*)::int as n from pg_roles where rolname = any($1::text[])", [
      [owner, runtime],
    ])).rows[0].n, 0);
    await admin.query(`grant create on database postgres to ${operator}`);

    // A precreated owner needs an explicit operator grant; migration must not
    // silently take it over or leave behind a partially installed schema.
    for (const role of [owner, runtime]) await admin.query(
      `create role ${role} nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls`);
    await assert.rejects(client.query(migration), (error) => error.code === "42501" && /requires SET on the precreated owner/u.test(error.message));
    await client.query("rollback");
    await noSchema(); await restoredSession();
    assert.equal((await admin.query("select count(*)::int as n from pg_roles where rolname = any($1::text[])", [
      [owner, runtime],
    ])).rows[0].n, 2);
    await admin.query(`grant ${owner} to ${operator} with set true, inherit false`);
    await client.query(migration);
    await restoredSession();
    // Only this disposable fixture is reset, to test a second fresh install.
    await admin.query(`drop schema ${schema} cascade`);
    await admin.query(`drop role ${owner}, ${runtime}`);

    await client.query(migration);
    await restoredSession();
    assert.deepEqual((await client.query(
      "select rolsuper, rolbypassrls, rolcreatedb, rolinherit from pg_roles where rolname=current_user")).rows[0],
    { rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolinherit: false });
    const ownership = (await admin.query(`
      select pg_get_userbyid(relowner) as owner from pg_class where relnamespace=$1::regnamespace
      union all select pg_get_userbyid(proowner) from pg_proc where pronamespace=$1::regnamespace`, [schema])).rows;
    assert.ok(ownership.length > 0 && ownership.every((row) => row.owner === owner));
    assert.equal((await admin.query("select count(*)::int as n from pg_auth_members where member in (select oid from pg_roles where rolname=any($1::text[]))", [
      [owner, runtime],
    ])).rows[0].n, 0);
    assert.deepEqual((await client.query(`select pg_has_role(current_user,$1,'USAGE') as inherits,
      pg_has_role(current_user,$1,'SET') as can_set, has_database_privilege($1,'postgres','CREATE') as owner_creates_schema`, [owner])).rows[0],
    { inherits: false, can_set: true, owner_creates_schema: false });
  } finally {
    await client.end();
  }
}
