import assert from "node:assert/strict";
import test from "node:test";
import { rootCertificates } from "node:tls";
import { postgresConnectionOptions } from "./postgres-connection.js";
import { createPostgresGuardJournal } from "./guard-publication-journal.js";
import { createPostgresPilotAdmission } from "./pilot-admission.js";

const base = "postgresql://runtime:synthetic@db.example/authority";
test("database connection policy rejects URL overrides and malformed CA before opening a pool", () => {
  for (const connectionString of [undefined, "", base, `${base}?sslmode=require`,
    `${base}?sslmode=no-verify`, `${base}?sslmode=verify-full&sslmode=disable`,
    `${base}?sslmode=verify-full&host=other.example`, `${base}?sslmode=verify-full&sslrootcert=/tmp/secret`,
    `${base}?sslmode=verify-full#fragment`, "postgresql://runtime:synthetic@%2ftmp/db?sslmode=verify-full"]) {
    assert.throws(() => postgresConnectionOptions({ connectionString }), {
      name: "TypeError", message: "A verified PostgreSQL connection is required.",
    });
  }
  for (const caCertificate of ["", "   ", false, null, "/tmp/secret", "https://provider.invalid/ca",
    "-----BEGIN CERTIFICATE-----\ninvalid\n-----END CERTIFICATE-----", "x".repeat(16385), `${rootCertificates[0]}${"\u2003".repeat(6000)}`]) {
    const configuration = { connectionString: `${base}?sslmode=verify-full`, caCertificate };
    assert.throws(() => postgresConnectionOptions(configuration), /^TypeError: A verified PostgreSQL connection is required\.$/u);
    assert.throws(() => createPostgresGuardJournal(configuration), (e) => e.code === "GUARD_PUBLICATION_UNAVAILABLE");
    assert.throws(() => createPostgresPilotAdmission(configuration), (e) => e.code === "PILOT_ADMISSION_UNAVAILABLE");
  }
});
