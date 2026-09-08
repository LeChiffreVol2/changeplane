import { X509Certificate } from "node:crypto";
import { checkServerIdentity } from "node:tls";

// Trusted operator configuration only. No URL-specified files, TLS downgrades,
// endpoint overrides, or process-wide trust changes are accepted.
export function postgresConnectionOptions({ connectionString, caCertificate } = {}) {
  try {
    if (typeof connectionString !== "string") throw new Error();
    const url = new URL(connectionString);
    if (!["postgres:", "postgresql:"].includes(url.protocol)
      || !url.hostname || !url.username || url.pathname.length <= 1
      || url.hostname.includes("%") || url.hash
      || url.searchParams.size !== 1 || url.searchParams.get("sslmode") !== "verify-full") throw new Error();
    let ca;
    if (caCertificate !== undefined) {
      if (typeof caCertificate !== "string" || Buffer.byteLength(caCertificate, "utf8") > 16384) throw new Error();
      const pem = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/gu;
      const certificates = caCertificate.match(pem);
      if (!certificates?.length || certificates.length > 4 || caCertificate.replace(pem, "").trim()) throw new Error();
      if (certificates.some((certificate) => !new X509Certificate(certificate).ca)) throw new Error();
      ca = certificates.join("\n");
    }
    const hostname = url.hostname.replace(/^\[|\]$/gu, "");
    // pg parses URL TLS parameters after the explicit ssl object and replaces
    // that object. Validate the external contract, then remove its sole option.
    url.search = "";
    return {
      connectionString: url.toString(),
      sslnegotiation: "postgres",
      ssl: { ...(ca === undefined ? {} : { ca }), minVersion: "TLSv1.2", rejectUnauthorized: true,
        checkServerIdentity: (_name, certificate) => checkServerIdentity(hostname, certificate) },
    };
  } catch {
    // Parsing failures must not expose a URL, credential, PEM or filesystem path.
    throw new TypeError("A verified PostgreSQL connection is required.");
  }
}
