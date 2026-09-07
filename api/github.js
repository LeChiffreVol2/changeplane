import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sodium from "libsodium-wrappers";

import {
  claimTrustedRepair,
  createGitHubAppJwt,
  createSecretsWriteInstallationAccessToken,
  deriveControllerSecret,
  issueTrustedRepairPushToken,
  publishTrustedRepair,
  validateTrustedRepair,
  validateClaimRequest,
  validateControllerRequest,
  verifyClaimRequest,
  verifyControllerRequest,
} from "../server/github-repair-controller.js";
import {
  compareGuardRunOrder,
  createChecksWriteInstallationAccessToken,
  createGuardReadInstallationAccessToken,
  decodeGuardRunMarker,
  encodeGuardRunMarker,
  guardBoundContractDigest,
  stableGuardCheckExternalId,
  validateGuardBeginBody,
  validateGuardReconciliationBody,
  validateGuardPublishBody,
  verifyGitHubActionsOidcToken,
} from "../server/github-guard-controller.js";
import {
  BYOK_SECRET_NAME,
  DEFAULT_PROPOSAL_MODEL,
  PROPOSAL_REASONING_EFFORT,
  RUNTIME_PROVIDER,
  proposalModel,
} from "../src/lib/runtime.js";
import {
  HARNESS_BUDGET_MINUTES,
  HARNESS_MAX_ATTEMPTS,
  HARNESS_MODE,
  githubWorkflowFilePath,
  harnessPolicy,
  validateRequiredChecks,
} from "../src/lib/harness.js";
import { githubRulesetReadiness } from "../src/lib/github-ruleset-readiness.js";
import { buildRulesetPlan } from "../src/lib/github-ruleset-plan.js";
import { buildSdlcAssurance } from "../src/lib/sdlc-assurance.js";
import { verifyAssuranceProof } from "../src/lib/assurance-proof.js";
import { runOriginBoundaryProof } from "../src/lib/assurance-lab.js";
import {
  buildProofLocator,
  digest as canonicalDigest,
  verifyAssurancePassportIntegrity,
  parseAssurancePassportIntegrity,
  verifyAssurancePassportAgainstCheck,
} from "../action/index.js";
import { DEFAULT_EVIDENCE_PROTECTED_PATHS } from "../examples/changeplane-evidence-policy.js";
import {
  repairLedgerKeyId,
  repairLedgerPublicKeyValue,
} from "../server/repair-ledger.js";
import { reconcileGuardState } from "../server/guard-reconciliation.js";
import { createPostgresGuardJournal, GuardPublicationError } from "../server/guard-publication-journal.js";
import { createPostgresPilotAdmission } from "../server/pilot-admission.js";

const API_VERSION = "2022-11-28";
const SESSION_COOKIE = "__Host-changeplane_session";
const OAUTH_COOKIE = "__Host-changeplane_oauth";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const OAUTH_TTL_MS = 10 * 60 * 1000;
const MAX_BODY_BYTES = 16 * 1024;
const MAX_REPAIR_BODY_BYTES = 128 * 1024;
const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";
const MANAGED_API_KEY_NAME = "CHANGEPLANE_MANAGED_OPENAI_API_KEY";
const BYOK_MIN_LENGTH = 20;
const BYOK_MAX_LENGTH = 512;
const HARNESS_SECRETS = Object.freeze({
  controller: "CHANGEPLANE_CONTROLLER_HMAC_V12",
  legacyController: "CHANGEPLANE_CONTROLLER_HMAC",
  installation: "CHANGEPLANE_CONTROLLER_INSTALLATION_ID",
  enabled: "CHANGEPLANE_REPAIR_ENABLED",
  generation: "CHANGEPLANE_REPAIR_GENERATION",
  publicKeys: "CHANGEPLANE_REPAIR_PUBLIC_KEYS",
});
const MAX_APP_INSTALLATIONS = 20;
const MAX_INSTALLATION_REPOSITORIES = 1_000;
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const VERIFIED_VERCEL_SOURCE = Object.freeze({
  environment: "production",
  provider: "github",
  owner: "LeChiffreVol2",
  repository: "changeplane",
  branch: "main",
});
const REQUIRED_SCOPES = ["repo", "workflow"];
const POLICY_PATH = ".changeplane.json";
const ASSURANCE_MEMORY_PATH = ".changeplane/assurance.md";
const MANAGED_MANIFEST_PATH = "changeplane/manifest.json";
const MANAGED_VERSION = 14;
// The repair credential protocol remains v12. Managed payload releases can
// advance independently without silently widening an existing credential.
const MANAGED_REPAIR_ACTIVATION = "managed-v12";
const LEGACY_CONTROLLER_TOMBSTONE = `retired-by-${MANAGED_REPAIR_ACTIVATION}`;
const MANAGED_PROFILE = Object.freeze({
  VERIFY_LITE: "verify-lite",
  FULL: "full",
});
const GUARD_EVALUATION_CHECK_NAME = "ChangePlane guard";
const MANAGED_PATHS = [
  "changeplane/action.yml",
  "changeplane/action/index.js",
  "changeplane/src/lib/changeplane.js",
  "changeplane/src/lib/harness.js",
  "changeplane/src/lib/review.js",
  "changeplane/src/lib/runtime.js",
  "changeplane/server/github-repair-controller.js",
  "changeplane/server/repair-ledger.js",
  "changeplane/examples/changeplane-claim.js",
  "changeplane/examples/changeplane-grant.js",
  "changeplane/examples/changeplane-evidence-policy.js",
  "changeplane/examples/changeplane-proposal.js",
  "changeplane/examples/changeplane-provider-openai.js",
  "changeplane/examples/changeplane-review-openai.js",
  "changeplane/examples/changeplane-review-run.js",
  "changeplane/package.json",
  ".github/workflows/changeplane.yml",
  ".github/workflows/changeplane-repair.yml",
];
const MANAGED_RESERVED_PATHS = [
  "changeplane",
  POLICY_PATH,
  ASSURANCE_MEMORY_PATH,
  ".github/workflows/changeplane.yml",
  ".github/workflows/changeplane-repair.yml",
];
// Version zero is the exact observe payload installed before managed manifests existed.
// Keep these immutable when a future managed version is added so pristine older installs
// remain distinguishable from repository-owned modifications.
const LEGACY_MANAGED_HASHES = Object.freeze({
  "changeplane/action.yml": "bdfa9833c9b0911c58aeba054eb6eab7b3f426c1e2907665bd4a8ecdc936cd9c",
  "changeplane/action/index.js": "ce15027ce8048c5fb83d7c73422c0646c7ebadfb991f057e0f03c73b673cb579",
  "changeplane/src/lib/changeplane.js": "4578704217c2c5d3eac50ade6a40ee588ab75d1de736aeb0041fbfe8ce5536e6",
  "changeplane/package.json": "609158e6c5fbc237939fa3ddf7faab80ab690bdc0c8d584414a885130103c4e8",
  ".github/workflows/changeplane.yml": "5fdd8358d20adec23ce72feb9bebe7c8f6eeea94a47856a1ee01480ae8de8b53",
});
// When MANAGED_VERSION advances, retain each prior manifest-backed version here.
// The installer may upgrade only bytes that match one of these immutable catalogs.
const KNOWN_MANAGED_VERSION_HASHES = Object.freeze({
  1: LEGACY_MANAGED_HASHES,
  2: Object.freeze({
    "changeplane/action.yml": "5efe0e2140283081e3e0390506c681fc881dbe47334a16038c0da9198dcba868",
    "changeplane/action/index.js": "ce15027ce8048c5fb83d7c73422c0646c7ebadfb991f057e0f03c73b673cb579",
    "changeplane/src/lib/changeplane.js": "4578704217c2c5d3eac50ade6a40ee588ab75d1de736aeb0041fbfe8ce5536e6",
    "changeplane/src/lib/harness.js": "0eb54fec0d65c7668d3b81be6174e8474ebcca670b834e5186e17b4efd6a1ac8",
    "changeplane/src/lib/runtime.js": "26cff8ddc82756d16577c938fb567c0a13cdd0ee3cf3a94f4f1a4bdd93293b3d",
    "changeplane/server/github-repair-controller.js": "fb0bd189e96193a73ea17692f99999ee0dd033f1b8d060b4c1c442fb0b141070",
    "changeplane/server/repair-ledger.js": "7536a8cf40d51e9606434d07da5874aac500a5b4bdae0daf59f338a1e5289ebc",
    "changeplane/examples/changeplane-claim.js": "e74f6ba36c273f775380035fd74a91f59ebc43878f4700d01a834af1adf6322d",
    "changeplane/examples/changeplane-grant.js": "427fd013ecd49e5ccf7fd714ac20b7b4f9526dae30835a532d57cff6e8ec5af5",
    "changeplane/examples/changeplane-proposal.js": "77e27bdafcdc94ceda9fdbdcc26cfae9f45e00fa77e0ae39c878c73126ca1333",
    "changeplane/examples/changeplane-provider-openai.js": "359be60bd45a44d208998e6350408e4cf80f2a4a0f99403e40a8e476a256ee9e",
    "changeplane/package.json": "609158e6c5fbc237939fa3ddf7faab80ab690bdc0c8d584414a885130103c4e8",
    ".github/workflows/changeplane.yml": "573a24fc6b18124f706ff7a557dc3a155e7642db7da76ef653cd34e1bd0a487f",
    ".github/workflows/changeplane-repair.yml": "3786efb2077b8d3bd4db4de507f2842b485c03ac976b5265acb1ef474921a0d6",
  }),
  3: Object.freeze({
    "changeplane/action.yml": "5efe0e2140283081e3e0390506c681fc881dbe47334a16038c0da9198dcba868",
    "changeplane/action/index.js": "86c6e763d78288352d024f60ebe7dbd90839b2997871a474b80aa43c2dec9ee2",
    "changeplane/src/lib/changeplane.js": "4578704217c2c5d3eac50ade6a40ee588ab75d1de736aeb0041fbfe8ce5536e6",
    "changeplane/src/lib/harness.js": "0eb54fec0d65c7668d3b81be6174e8474ebcca670b834e5186e17b4efd6a1ac8",
    "changeplane/src/lib/runtime.js": "26cff8ddc82756d16577c938fb567c0a13cdd0ee3cf3a94f4f1a4bdd93293b3d",
    "changeplane/server/github-repair-controller.js": "fb0bd189e96193a73ea17692f99999ee0dd033f1b8d060b4c1c442fb0b141070",
    "changeplane/server/repair-ledger.js": "7536a8cf40d51e9606434d07da5874aac500a5b4bdae0daf59f338a1e5289ebc",
    "changeplane/examples/changeplane-claim.js": "e74f6ba36c273f775380035fd74a91f59ebc43878f4700d01a834af1adf6322d",
    "changeplane/examples/changeplane-grant.js": "427fd013ecd49e5ccf7fd714ac20b7b4f9526dae30835a532d57cff6e8ec5af5",
    "changeplane/examples/changeplane-proposal.js": "77e27bdafcdc94ceda9fdbdcc26cfae9f45e00fa77e0ae39c878c73126ca1333",
    "changeplane/examples/changeplane-provider-openai.js": "359be60bd45a44d208998e6350408e4cf80f2a4a0f99403e40a8e476a256ee9e",
    "changeplane/package.json": "609158e6c5fbc237939fa3ddf7faab80ab690bdc0c8d584414a885130103c4e8",
    ".github/workflows/changeplane.yml": "573a24fc6b18124f706ff7a557dc3a155e7642db7da76ef653cd34e1bd0a487f",
    ".github/workflows/changeplane-repair.yml": "ae8955658bdea4e7be8241e286fd1d43a28b9ef5a8af4107771809a520e54113",
  }),
  4: Object.freeze({
    "changeplane/action.yml": "5efe0e2140283081e3e0390506c681fc881dbe47334a16038c0da9198dcba868",
    "changeplane/action/index.js": "86c6e763d78288352d024f60ebe7dbd90839b2997871a474b80aa43c2dec9ee2",
    "changeplane/src/lib/changeplane.js": "4578704217c2c5d3eac50ade6a40ee588ab75d1de736aeb0041fbfe8ce5536e6",
    "changeplane/src/lib/harness.js": "0eb54fec0d65c7668d3b81be6174e8474ebcca670b834e5186e17b4efd6a1ac8",
    "changeplane/src/lib/runtime.js": "26cff8ddc82756d16577c938fb567c0a13cdd0ee3cf3a94f4f1a4bdd93293b3d",
    "changeplane/server/github-repair-controller.js": "fb0bd189e96193a73ea17692f99999ee0dd033f1b8d060b4c1c442fb0b141070",
    "changeplane/server/repair-ledger.js": "7536a8cf40d51e9606434d07da5874aac500a5b4bdae0daf59f338a1e5289ebc",
    "changeplane/examples/changeplane-claim.js": "e74f6ba36c273f775380035fd74a91f59ebc43878f4700d01a834af1adf6322d",
    "changeplane/examples/changeplane-grant.js": "427fd013ecd49e5ccf7fd714ac20b7b4f9526dae30835a532d57cff6e8ec5af5",
    "changeplane/examples/changeplane-proposal.js": "aa9876c78c1ae62904c9fa76ad3c0f018c3d0435569e4d79b8805fe2bfa05c14",
    "changeplane/examples/changeplane-provider-openai.js": "28c2264457b438d4e0830d1c378121c1892b0883888068e4fa95a4b2708373bb",
    "changeplane/package.json": "609158e6c5fbc237939fa3ddf7faab80ab690bdc0c8d584414a885130103c4e8",
    ".github/workflows/changeplane.yml": "573a24fc6b18124f706ff7a557dc3a155e7642db7da76ef653cd34e1bd0a487f",
    ".github/workflows/changeplane-repair.yml": "ae8955658bdea4e7be8241e286fd1d43a28b9ef5a8af4107771809a520e54113",
  }),
  5: Object.freeze({
    "changeplane/action.yml": "5efe0e2140283081e3e0390506c681fc881dbe47334a16038c0da9198dcba868",
    "changeplane/action/index.js": "ea330794dfc3c9cd2cf1753a67f72cd0fdd71cb6946e80fbb7fe5a97dca71bf2",
    "changeplane/src/lib/changeplane.js": "4578704217c2c5d3eac50ade6a40ee588ab75d1de736aeb0041fbfe8ce5536e6",
    "changeplane/src/lib/harness.js": "0eb54fec0d65c7668d3b81be6174e8474ebcca670b834e5186e17b4efd6a1ac8",
    "changeplane/src/lib/runtime.js": "26cff8ddc82756d16577c938fb567c0a13cdd0ee3cf3a94f4f1a4bdd93293b3d",
    "changeplane/server/github-repair-controller.js": "fb0bd189e96193a73ea17692f99999ee0dd033f1b8d060b4c1c442fb0b141070",
    "changeplane/server/repair-ledger.js": "7536a8cf40d51e9606434d07da5874aac500a5b4bdae0daf59f338a1e5289ebc",
    "changeplane/examples/changeplane-claim.js": "e74f6ba36c273f775380035fd74a91f59ebc43878f4700d01a834af1adf6322d",
    "changeplane/examples/changeplane-grant.js": "427fd013ecd49e5ccf7fd714ac20b7b4f9526dae30835a532d57cff6e8ec5af5",
    "changeplane/examples/changeplane-proposal.js": "aa9876c78c1ae62904c9fa76ad3c0f018c3d0435569e4d79b8805fe2bfa05c14",
    "changeplane/examples/changeplane-provider-openai.js": "28c2264457b438d4e0830d1c378121c1892b0883888068e4fa95a4b2708373bb",
    "changeplane/package.json": "609158e6c5fbc237939fa3ddf7faab80ab690bdc0c8d584414a885130103c4e8",
    ".github/workflows/changeplane.yml": "573a24fc6b18124f706ff7a557dc3a155e7642db7da76ef653cd34e1bd0a487f",
    ".github/workflows/changeplane-repair.yml": "ae8955658bdea4e7be8241e286fd1d43a28b9ef5a8af4107771809a520e54113",
  }),
  6: Object.freeze({
    "changeplane/action.yml": "5efe0e2140283081e3e0390506c681fc881dbe47334a16038c0da9198dcba868",
    "changeplane/action/index.js": "ea330794dfc3c9cd2cf1753a67f72cd0fdd71cb6946e80fbb7fe5a97dca71bf2",
    "changeplane/src/lib/changeplane.js": "4578704217c2c5d3eac50ade6a40ee588ab75d1de736aeb0041fbfe8ce5536e6",
    "changeplane/src/lib/harness.js": "0eb54fec0d65c7668d3b81be6174e8474ebcca670b834e5186e17b4efd6a1ac8",
    "changeplane/src/lib/runtime.js": "26cff8ddc82756d16577c938fb567c0a13cdd0ee3cf3a94f4f1a4bdd93293b3d",
    "changeplane/server/github-repair-controller.js": "fb0bd189e96193a73ea17692f99999ee0dd033f1b8d060b4c1c442fb0b141070",
    "changeplane/server/repair-ledger.js": "7536a8cf40d51e9606434d07da5874aac500a5b4bdae0daf59f338a1e5289ebc",
    "changeplane/examples/changeplane-claim.js": "e74f6ba36c273f775380035fd74a91f59ebc43878f4700d01a834af1adf6322d",
    "changeplane/examples/changeplane-grant.js": "427fd013ecd49e5ccf7fd714ac20b7b4f9526dae30835a532d57cff6e8ec5af5",
    "changeplane/examples/changeplane-proposal.js": "aa9876c78c1ae62904c9fa76ad3c0f018c3d0435569e4d79b8805fe2bfa05c14",
    "changeplane/examples/changeplane-provider-openai.js": "28c2264457b438d4e0830d1c378121c1892b0883888068e4fa95a4b2708373bb",
    "changeplane/package.json": "609158e6c5fbc237939fa3ddf7faab80ab690bdc0c8d584414a885130103c4e8",
    ".github/workflows/changeplane.yml": "f8a241d54c5a84c24ce2b333c25ca688f6f0f81dceb1ae65337057d4881c41f2",
    ".github/workflows/changeplane-repair.yml": "ae8955658bdea4e7be8241e286fd1d43a28b9ef5a8af4107771809a520e54113",
  }),
  7: Object.freeze({
    "changeplane/action.yml": "5a0cde8e0977c921ddbc89dd02a2aa1ce910da1c29a85fc8700a06787c249ef5",
    "changeplane/action/index.js": "b04c92e3f54820bd2d43a495f90e5e9c41b4730c0c8abebfe6b610e70d147b1f",
    "changeplane/src/lib/changeplane.js": "4578704217c2c5d3eac50ade6a40ee588ab75d1de736aeb0041fbfe8ce5536e6",
    "changeplane/src/lib/harness.js": "0eb54fec0d65c7668d3b81be6174e8474ebcca670b834e5186e17b4efd6a1ac8",
    "changeplane/src/lib/review.js": "77b6e85321827a18a305bf4a952d6493d831374e8208eeca0e0987d1fd95023d",
    "changeplane/src/lib/runtime.js": "26cff8ddc82756d16577c938fb567c0a13cdd0ee3cf3a94f4f1a4bdd93293b3d",
    "changeplane/server/github-repair-controller.js": "fb0bd189e96193a73ea17692f99999ee0dd033f1b8d060b4c1c442fb0b141070",
    "changeplane/server/repair-ledger.js": "7536a8cf40d51e9606434d07da5874aac500a5b4bdae0daf59f338a1e5289ebc",
    "changeplane/examples/changeplane-claim.js": "e74f6ba36c273f775380035fd74a91f59ebc43878f4700d01a834af1adf6322d",
    "changeplane/examples/changeplane-grant.js": "427fd013ecd49e5ccf7fd714ac20b7b4f9526dae30835a532d57cff6e8ec5af5",
    "changeplane/examples/changeplane-proposal.js": "aa9876c78c1ae62904c9fa76ad3c0f018c3d0435569e4d79b8805fe2bfa05c14",
    "changeplane/examples/changeplane-provider-openai.js": "28c2264457b438d4e0830d1c378121c1892b0883888068e4fa95a4b2708373bb",
    "changeplane/examples/changeplane-review-openai.js": "5be177e0c93b8e68df59de57d5d29686552312caa5705ba7e710a6f2501f339d",
    "changeplane/examples/changeplane-review-run.js": "15416ebc602a1981f171c75471d3a28cc18c1da69473a7ed36ed35991bebf9f5",
    "changeplane/package.json": "609158e6c5fbc237939fa3ddf7faab80ab690bdc0c8d584414a885130103c4e8",
    ".github/workflows/changeplane.yml": "cc4d3bb7fc810227b46e9bd4a5b69bd44d7466c6f9160a941ff41bb637a45a66",
    ".github/workflows/changeplane-repair.yml": "ae8955658bdea4e7be8241e286fd1d43a28b9ef5a8af4107771809a520e54113",
  }),
  8: Object.freeze({
    "changeplane/action.yml": "5a0cde8e0977c921ddbc89dd02a2aa1ce910da1c29a85fc8700a06787c249ef5",
    "changeplane/action/index.js": "b04c92e3f54820bd2d43a495f90e5e9c41b4730c0c8abebfe6b610e70d147b1f",
    "changeplane/src/lib/changeplane.js": "4578704217c2c5d3eac50ade6a40ee588ab75d1de736aeb0041fbfe8ce5536e6",
    "changeplane/src/lib/harness.js": "0eb54fec0d65c7668d3b81be6174e8474ebcca670b834e5186e17b4efd6a1ac8",
    "changeplane/src/lib/review.js": "77b6e85321827a18a305bf4a952d6493d831374e8208eeca0e0987d1fd95023d",
    "changeplane/src/lib/runtime.js": "26cff8ddc82756d16577c938fb567c0a13cdd0ee3cf3a94f4f1a4bdd93293b3d",
    "changeplane/server/github-repair-controller.js": "fb0bd189e96193a73ea17692f99999ee0dd033f1b8d060b4c1c442fb0b141070",
    "changeplane/server/repair-ledger.js": "7536a8cf40d51e9606434d07da5874aac500a5b4bdae0daf59f338a1e5289ebc",
    "changeplane/examples/changeplane-claim.js": "e74f6ba36c273f775380035fd74a91f59ebc43878f4700d01a834af1adf6322d",
    "changeplane/examples/changeplane-grant.js": "427fd013ecd49e5ccf7fd714ac20b7b4f9526dae30835a532d57cff6e8ec5af5",
    "changeplane/examples/changeplane-proposal.js": "aa9876c78c1ae62904c9fa76ad3c0f018c3d0435569e4d79b8805fe2bfa05c14",
    "changeplane/examples/changeplane-provider-openai.js": "f217665808dadfd180c960e6a1ab583b1e0d9d3c217578575e3cbf423eb348f8",
    "changeplane/examples/changeplane-review-openai.js": "5be177e0c93b8e68df59de57d5d29686552312caa5705ba7e710a6f2501f339d",
    "changeplane/examples/changeplane-review-run.js": "15416ebc602a1981f171c75471d3a28cc18c1da69473a7ed36ed35991bebf9f5",
    "changeplane/package.json": "609158e6c5fbc237939fa3ddf7faab80ab690bdc0c8d584414a885130103c4e8",
    ".github/workflows/changeplane.yml": "cc4d3bb7fc810227b46e9bd4a5b69bd44d7466c6f9160a941ff41bb637a45a66",
    ".github/workflows/changeplane-repair.yml": "ae8955658bdea4e7be8241e286fd1d43a28b9ef5a8af4107771809a520e54113",
  }),
  9: Object.freeze({
    "changeplane/action.yml": "5a0cde8e0977c921ddbc89dd02a2aa1ce910da1c29a85fc8700a06787c249ef5",
    "changeplane/action/index.js": "b04c92e3f54820bd2d43a495f90e5e9c41b4730c0c8abebfe6b610e70d147b1f",
    "changeplane/src/lib/changeplane.js": "4578704217c2c5d3eac50ade6a40ee588ab75d1de736aeb0041fbfe8ce5536e6",
    "changeplane/src/lib/harness.js": "0eb54fec0d65c7668d3b81be6174e8474ebcca670b834e5186e17b4efd6a1ac8",
    "changeplane/src/lib/review.js": "77b6e85321827a18a305bf4a952d6493d831374e8208eeca0e0987d1fd95023d",
    "changeplane/src/lib/runtime.js": "26cff8ddc82756d16577c938fb567c0a13cdd0ee3cf3a94f4f1a4bdd93293b3d",
    "changeplane/server/github-repair-controller.js": "fb0bd189e96193a73ea17692f99999ee0dd033f1b8d060b4c1c442fb0b141070",
    "changeplane/server/repair-ledger.js": "7536a8cf40d51e9606434d07da5874aac500a5b4bdae0daf59f338a1e5289ebc",
    "changeplane/examples/changeplane-claim.js": "e74f6ba36c273f775380035fd74a91f59ebc43878f4700d01a834af1adf6322d",
    "changeplane/examples/changeplane-grant.js": "427fd013ecd49e5ccf7fd714ac20b7b4f9526dae30835a532d57cff6e8ec5af5",
    "changeplane/examples/changeplane-proposal.js": "92581707a98ee3bca63f1ff46ad0d7646aebbfa57f2c4082a0dd7a2638d2c9e6",
    "changeplane/examples/changeplane-provider-openai.js": "f217665808dadfd180c960e6a1ab583b1e0d9d3c217578575e3cbf423eb348f8",
    "changeplane/examples/changeplane-review-openai.js": "5be177e0c93b8e68df59de57d5d29686552312caa5705ba7e710a6f2501f339d",
    "changeplane/examples/changeplane-review-run.js": "15416ebc602a1981f171c75471d3a28cc18c1da69473a7ed36ed35991bebf9f5",
    "changeplane/package.json": "609158e6c5fbc237939fa3ddf7faab80ab690bdc0c8d584414a885130103c4e8",
    ".github/workflows/changeplane.yml": "cc4d3bb7fc810227b46e9bd4a5b69bd44d7466c6f9160a941ff41bb637a45a66",
    ".github/workflows/changeplane-repair.yml": "ae8955658bdea4e7be8241e286fd1d43a28b9ef5a8af4107771809a520e54113",
  }),
  10: Object.freeze({
    "changeplane/action.yml": "5a0cde8e0977c921ddbc89dd02a2aa1ce910da1c29a85fc8700a06787c249ef5",
    "changeplane/action/index.js": "94bad97303c1abe64b1e904045d90f4b0186f301957d50fe17d131b417898041",
    "changeplane/src/lib/changeplane.js": "4578704217c2c5d3eac50ade6a40ee588ab75d1de736aeb0041fbfe8ce5536e6",
    "changeplane/src/lib/harness.js": "0eb54fec0d65c7668d3b81be6174e8474ebcca670b834e5186e17b4efd6a1ac8",
    "changeplane/src/lib/review.js": "77b6e85321827a18a305bf4a952d6493d831374e8208eeca0e0987d1fd95023d",
    "changeplane/src/lib/runtime.js": "26cff8ddc82756d16577c938fb567c0a13cdd0ee3cf3a94f4f1a4bdd93293b3d",
    "changeplane/server/github-repair-controller.js": "3b8f7055c74621c52a585550b2a4e96d8968d393202cacf5123e0aba32dcf8a9",
    "changeplane/server/repair-ledger.js": "7536a8cf40d51e9606434d07da5874aac500a5b4bdae0daf59f338a1e5289ebc",
    "changeplane/examples/changeplane-claim.js": "e74f6ba36c273f775380035fd74a91f59ebc43878f4700d01a834af1adf6322d",
    "changeplane/examples/changeplane-grant.js": "427fd013ecd49e5ccf7fd714ac20b7b4f9526dae30835a532d57cff6e8ec5af5",
    "changeplane/examples/changeplane-evidence-policy.js": "cc8521368126ccf23a31564633ac80cc393ff270c0e6e5f4588b9cb3c0a1fd7e",
    "changeplane/examples/changeplane-proposal.js": "23fab0694682ee7a775c8771bb34bb98316edd50cdef25fb382ccab6d51eaba2",
    "changeplane/examples/changeplane-provider-openai.js": "f217665808dadfd180c960e6a1ab583b1e0d9d3c217578575e3cbf423eb348f8",
    "changeplane/examples/changeplane-review-openai.js": "5be177e0c93b8e68df59de57d5d29686552312caa5705ba7e710a6f2501f339d",
    "changeplane/examples/changeplane-review-run.js": "15416ebc602a1981f171c75471d3a28cc18c1da69473a7ed36ed35991bebf9f5",
    "changeplane/package.json": "609158e6c5fbc237939fa3ddf7faab80ab690bdc0c8d584414a885130103c4e8",
    ".github/workflows/changeplane.yml": "cc4d3bb7fc810227b46e9bd4a5b69bd44d7466c6f9160a941ff41bb637a45a66",
    ".github/workflows/changeplane-repair.yml": "ae8955658bdea4e7be8241e286fd1d43a28b9ef5a8af4107771809a520e54113",
  }),
  11: Object.freeze({
    "changeplane/action.yml": "5a0cde8e0977c921ddbc89dd02a2aa1ce910da1c29a85fc8700a06787c249ef5",
    "changeplane/action/index.js": "f7eb0eaf24364cdff855ac552bf3c4e48b865034738d4ae4131dd04e7ac07cf0",
    "changeplane/src/lib/changeplane.js": "4578704217c2c5d3eac50ade6a40ee588ab75d1de736aeb0041fbfe8ce5536e6",
    "changeplane/src/lib/harness.js": "0eb54fec0d65c7668d3b81be6174e8474ebcca670b834e5186e17b4efd6a1ac8",
    "changeplane/src/lib/review.js": "77b6e85321827a18a305bf4a952d6493d831374e8208eeca0e0987d1fd95023d",
    "changeplane/src/lib/runtime.js": "26cff8ddc82756d16577c938fb567c0a13cdd0ee3cf3a94f4f1a4bdd93293b3d",
    "changeplane/server/github-repair-controller.js": "3b8f7055c74621c52a585550b2a4e96d8968d393202cacf5123e0aba32dcf8a9",
    "changeplane/server/repair-ledger.js": "7536a8cf40d51e9606434d07da5874aac500a5b4bdae0daf59f338a1e5289ebc",
    "changeplane/examples/changeplane-claim.js": "e74f6ba36c273f775380035fd74a91f59ebc43878f4700d01a834af1adf6322d",
    "changeplane/examples/changeplane-grant.js": "427fd013ecd49e5ccf7fd714ac20b7b4f9526dae30835a532d57cff6e8ec5af5",
    "changeplane/examples/changeplane-evidence-policy.js": "cc8521368126ccf23a31564633ac80cc393ff270c0e6e5f4588b9cb3c0a1fd7e",
    "changeplane/examples/changeplane-proposal.js": "23fab0694682ee7a775c8771bb34bb98316edd50cdef25fb382ccab6d51eaba2",
    "changeplane/examples/changeplane-provider-openai.js": "f217665808dadfd180c960e6a1ab583b1e0d9d3c217578575e3cbf423eb348f8",
    "changeplane/examples/changeplane-review-openai.js": "5be177e0c93b8e68df59de57d5d29686552312caa5705ba7e710a6f2501f339d",
    "changeplane/examples/changeplane-review-run.js": "15416ebc602a1981f171c75471d3a28cc18c1da69473a7ed36ed35991bebf9f5",
    "changeplane/package.json": "609158e6c5fbc237939fa3ddf7faab80ab690bdc0c8d584414a885130103c4e8",
    ".github/workflows/changeplane.yml": "cc4d3bb7fc810227b46e9bd4a5b69bd44d7466c6f9160a941ff41bb637a45a66",
    ".github/workflows/changeplane-repair.yml": "ae8955658bdea4e7be8241e286fd1d43a28b9ef5a8af4107771809a520e54113",
  }),
  12: Object.freeze({
    "changeplane/action.yml": "a2f70842db67003ee9aedf73fe5bfbb929d0e5adfaf70bfb577314d685cf40c2",
    "changeplane/action/index.js": "c70fddc5b742da8e77fb7ac9311c8ee0c2f1623f3a866ef188ca49e74b3d951e",
    "changeplane/src/lib/changeplane.js": "c928a2bd6e3f19134b4dac6957907d907da8fc27f59168d230068466d1d7b1bd",
    "changeplane/src/lib/harness.js": "c7cda36b22b25c11c65321b0bbb8b43fcbc28de17b6af0ec46196c31833ed3bf",
    "changeplane/src/lib/review.js": "77b6e85321827a18a305bf4a952d6493d831374e8208eeca0e0987d1fd95023d",
    "changeplane/src/lib/runtime.js": "26cff8ddc82756d16577c938fb567c0a13cdd0ee3cf3a94f4f1a4bdd93293b3d",
    "changeplane/server/github-repair-controller.js": "40c4ec34776cb12f2618a5655c5aad740828893ce11b32ad9a47b527b17c4042",
    "changeplane/server/repair-ledger.js": "7536a8cf40d51e9606434d07da5874aac500a5b4bdae0daf59f338a1e5289ebc",
    "changeplane/examples/changeplane-claim.js": "b391de111c6c5e4bb33991e6624db4f4347862ecee3c3478ecc8dbfc85997f83",
    "changeplane/examples/changeplane-grant.js": "648037cd2f18d4161f75c7dc7fedbc1317a5b78f6b53ac3df121f9b3eb76b9a1",
    "changeplane/examples/changeplane-evidence-policy.js": "cc8521368126ccf23a31564633ac80cc393ff270c0e6e5f4588b9cb3c0a1fd7e",
    "changeplane/examples/changeplane-proposal.js": "23fab0694682ee7a775c8771bb34bb98316edd50cdef25fb382ccab6d51eaba2",
    "changeplane/examples/changeplane-provider-openai.js": "f217665808dadfd180c960e6a1ab583b1e0d9d3c217578575e3cbf423eb348f8",
    "changeplane/examples/changeplane-review-openai.js": "5be177e0c93b8e68df59de57d5d29686552312caa5705ba7e710a6f2501f339d",
    "changeplane/examples/changeplane-review-run.js": "5dcdb7204c3a090d3aec88af6e82153f7f447389136c0c84d41f08895ea08d2e",
    "changeplane/package.json": "609158e6c5fbc237939fa3ddf7faab80ab690bdc0c8d584414a885130103c4e8",
    ".github/workflows/changeplane.yml": "776c4694d3e4921909315d8372ecba24085c0c60bb5be174b43c655b110196de",
    ".github/workflows/changeplane-repair.yml": "7d18ee493de579c22d2b7093f834d0bdb20d4d60fe7219dfad2eb85e60f2d45f",
  }),
  13: Object.freeze({
    "full": Object.freeze({
      "changeplane/action.yml": "33100f509832d7dd3eefdfe81d30497cda4649848420017b790b9932e2d6c3d3",
      "changeplane/action/index.js": "14811236289a1afadf50de85ee127c295a4a1989d694cb2c731d3051ef4eb23e",
      "changeplane/src/lib/changeplane.js": "58af3209cbc0fb52d354a4984fca3f752bbb26241d3f403c3f5d783fe2e0c8ab",
      "changeplane/src/lib/harness.js": "c377b11f0ee668dab1b894cb92d45787e5f7d5e68a015569f3326f18ad65a023",
      "changeplane/src/lib/review.js": "77b6e85321827a18a305bf4a952d6493d831374e8208eeca0e0987d1fd95023d",
      "changeplane/src/lib/runtime.js": "e4fcb217c60f23217023c52b56c5c195c4a4442d86ae78301f81d7c537c80e7c",
      "changeplane/server/github-repair-controller.js": "b67e56892908874717771a114adb378b7c2243ac6e2c364951d1034fd9fc1ddd",
      "changeplane/server/repair-ledger.js": "7536a8cf40d51e9606434d07da5874aac500a5b4bdae0daf59f338a1e5289ebc",
      "changeplane/examples/changeplane-claim.js": "b391de111c6c5e4bb33991e6624db4f4347862ecee3c3478ecc8dbfc85997f83",
      "changeplane/examples/changeplane-grant.js": "648037cd2f18d4161f75c7dc7fedbc1317a5b78f6b53ac3df121f9b3eb76b9a1",
      "changeplane/examples/changeplane-evidence-policy.js": "f187c979276501f2f7e8435c479e6ae94df6c5496ef1aec8e5afc4a71ebaf4a3",
      "changeplane/examples/changeplane-proposal.js": "e43d6f6809db1bc2d73516184be611565c77ce47f7b8c064188ea8fa83d6d8e5",
      "changeplane/examples/changeplane-provider-openai.js": "f217665808dadfd180c960e6a1ab583b1e0d9d3c217578575e3cbf423eb348f8",
      "changeplane/examples/changeplane-review-openai.js": "5be177e0c93b8e68df59de57d5d29686552312caa5705ba7e710a6f2501f339d",
      "changeplane/examples/changeplane-review-run.js": "5dcdb7204c3a090d3aec88af6e82153f7f447389136c0c84d41f08895ea08d2e",
      "changeplane/package.json": "609158e6c5fbc237939fa3ddf7faab80ab690bdc0c8d584414a885130103c4e8",
      ".github/workflows/changeplane.yml": "71919b7998ce010f25e1b078febd7722a8c4662504ec3ac6cc3b4a4a0f262b1b",
      ".github/workflows/changeplane-repair.yml": "7d18ee493de579c22d2b7093f834d0bdb20d4d60fe7219dfad2eb85e60f2d45f"
    }),
    "verify-lite": Object.freeze({
      "changeplane/action.yml": "33100f509832d7dd3eefdfe81d30497cda4649848420017b790b9932e2d6c3d3",
      "changeplane/action/index.js": "14811236289a1afadf50de85ee127c295a4a1989d694cb2c731d3051ef4eb23e",
      "changeplane/src/lib/changeplane.js": "58af3209cbc0fb52d354a4984fca3f752bbb26241d3f403c3f5d783fe2e0c8ab",
      "changeplane/src/lib/harness.js": "c377b11f0ee668dab1b894cb92d45787e5f7d5e68a015569f3326f18ad65a023",
      "changeplane/examples/changeplane-evidence-policy.js": "f187c979276501f2f7e8435c479e6ae94df6c5496ef1aec8e5afc4a71ebaf4a3",
      "changeplane/package.json": "609158e6c5fbc237939fa3ddf7faab80ab690bdc0c8d584414a885130103c4e8",
      ".github/workflows/changeplane.yml": "550ef2f0fd030686ac5b2d9b285cbc0019d751a171e239515f86f61279de1f20"
    }),
  }),
});
const TRANSIENT_GITHUB_STATUSES = new Set([502, 503, 504]);
const GITHUB_MAX_GET_ATTEMPTS = 3;
const SERVERLESS_MAX_RETRY_DELAY_MS = 2_000;
const REQUIRED_GITHUB_APP_PERMISSIONS = Object.freeze({
  actions: "read",
  administration: "write",
  contents: "write",
  pull_requests: "write",
  workflows: "write",
  checks: "write",
});
const OBSERVE_SETUP_BRANCH = "changeplane/observe-setup";
const OBSERVE_UPGRADE_BRANCH = `changeplane/observe-upgrade-v${MANAGED_VERSION}`;
const RUNTIME_CONFIG_BRANCH = "changeplane/runtime-model";
const GUARD_CHECK_NAME = "ChangePlane / guard";
const REVIEW_CHECK_NAME = "ChangePlane / review";
const RESERVED_CHANGEPLANE_CHECK_NAMES = new Set([
  GUARD_CHECK_NAME,
  GUARD_EVALUATION_CHECK_NAME,
  REVIEW_CHECK_NAME,
]);
const ASSURANCE_MEMORY_TEMPLATE = `# ChangePlane assurance memory

This file is repository-owned context for independent review. It guides findings but never issues PASS; only exact-revision evidence evaluated by the trusted harness can do that.

## Repository invariants

- Add concrete behavior that must remain true, with the test or runbook that proves it when one exists.

## Security boundaries

- Add trust boundaries, protected data flows, and paths that require human review.

## Compatibility commitments

- Add public API, schema, migration, or client behavior that changes must preserve.

## Operational checks

- Add deployment, rollback, and incident constraints reviewers should verify on changed lines.
`;
const ROUTE_METHODS = new Map([
  ["session", ["GET"]],
  ["readiness", ["GET"]],
  ["origin-proof", ["GET"]],
  ["proof", ["GET"]],
  ["guard-publish", ["POST"]],
  ["login", ["GET"]],
  ["authorize", ["GET"]],
  ["installation", ["GET"]],
  ["callback", ["GET"]],
  ["repos", ["GET"]],
  ["preflight", ["GET"]],
  ["ruleset-plan", ["GET"]],
  ["ruleset-apply", ["POST"]],
  ["reconcile", ["POST"]],
  ["runtime", ["GET", "POST"]],
  ["byok", ["GET", "POST", "DELETE"]],
  ["install", ["POST"]],
  ["repair", ["POST"]],
  ["repair-claim", ["POST"]],
  ["repair-push-token", ["POST"]],
  ["repair-validate", ["POST"]],
  ["logout", ["POST"]],
]);
const EXTERNAL_ACCESS_ACTIONS = new Set([
  "login",
  "authorize",
  "installation",
  "callback",
  "repos",
  "preflight",
  "ruleset-plan",
  "ruleset-apply",
  "reconcile",
  "runtime",
  "proof",
  "guard-publish",
  "byok",
  "install",
  "repair",
  "repair-claim",
  "repair-push-token",
  "repair-validate",
]);
// The store and quota contracts remain candidates until production ingestion is implemented.
const COMMERCIAL_RUNTIME_INTEGRATED = false;
// The durable journal candidate needs live topology, migration and canary proof.
// Configuration alone cannot enable customer access across that release gate.
const GUARD_PUBLICATION_SERIALIZED = false;
let guardJournalCache = null;
let pilotAdmissionCache = null;

function verifiedPostgresUrl(connectionString) {
  try {
    const url = new URL(connectionString);
    return ["postgres:", "postgresql:"].includes(url.protocol)
      && Boolean(url.hostname && url.username && url.pathname.length > 1)
      && !url.hostname.includes("%") && !url.hash
      // pg accepts duplicate, endpoint and file overrides. Only one reviewed
      // TLS option is supported in hosted database configuration.
      && url.searchParams.size === 1 && url.searchParams.get("sslmode") === "verify-full";
  } catch { return false; }
}

function pilotAdmissionRequested(suppliedPilotAdmission = null) {
  return suppliedPilotAdmission !== null
    || process.env.CHANGEPLANE_COMMERCIAL_STORE_ENABLED === "true"
    || (process.env.VERCEL === "1" && rolloutMode() !== "controlled_canary");
}

function pilotAdmissionIsConfigured() {
  const release = currentReleaseBinding();
  return commercialStoreIsConfigured() && /^[a-f0-9]{40}$/u.test(release ?? "")
    && process.env.CHANGEPLANE_COMMERCIAL_STORE_VERIFIED_RELEASE === release;
}

function guardJournalConfiguration({ required = process.env.VERCEL === "1" } = {}) {
  const requested = required || Object.keys(process.env).some((name) => name.startsWith("CHANGEPLANE_GUARD_JOURNAL_"));
  if (!requested) return null;
  const releaseSha = currentReleaseBinding();
  const epoch = process.env.CHANGEPLANE_GUARD_JOURNAL_EPOCH;
  const connectionString = process.env.CHANGEPLANE_GUARD_JOURNAL_DATABASE_URL;
  if (process.env.CHANGEPLANE_GUARD_JOURNAL_ENABLED !== "true"
    || !verifiedPostgresUrl(connectionString) || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(epoch ?? "")
    || !/^[a-f0-9]{40}$/u.test(releaseSha ?? "")
    || process.env.CHANGEPLANE_GUARD_JOURNAL_VERIFIED_RELEASE !== releaseSha
    || guardPrincipalSeparation() !== "separate_guard_app") {
    throw new GuardPublicationError("GUARD_PUBLICATION_AUTHORITY");
  }
  return { connectionString, epoch, releaseSha };
}

function guardJournalRuntime(suppliedJournal = null) {
  const configuration = guardJournalConfiguration({ required: process.env.VERCEL === "1" || suppliedJournal !== null });
  if (!configuration) return null;
  if (suppliedJournal) return { ...configuration, journal: suppliedJournal };
  if (guardJournalCache?.connectionString !== configuration.connectionString) {
    // Credentials never leave this closure. Rotation must first drain or fence
    // writers: closing an old pool cannot release its durable reservations.
    const previous = guardJournalCache;
    guardJournalCache = {
      connectionString: configuration.connectionString,
      journal: createPostgresGuardJournal({ connectionString: configuration.connectionString }),
    };
    previous?.journal.close().catch(() => {});
  }
  return { ...configuration, journal: guardJournalCache.journal };
}

async function withGuardPublication(runtime, { repo, installation, configuration, headSha, operation }, callback) {
  // Non-hosted fixtures retain their existing adapter; hosted writes cannot enter
  // this branch, including when an operator disables a previously active journal.
  if (!runtime) return callback({ write: (mutateAndValidate) => mutateAndValidate() });
  const tenantId = repo?.owner?.id;
  if (!Number.isSafeInteger(tenantId) || tenantId < 1 || installation?.account?.id !== tenantId
    || !/^[a-f0-9]{40}$/u.test(headSha ?? "")) {
    throw new GuardPublicationError("GUARD_PUBLICATION_AUTHORITY");
  }
  return runtime.journal.withPublication({
    tenantId,
    repositoryId: repo.id,
    installationId: installation.id,
    guardAppId: configuration.appId,
    epoch: runtime.epoch,
    releaseSha: runtime.releaseSha,
    revisionFingerprint: createHash("sha256").update(`${repo.id}\0${headSha}`).digest("hex"),
    operation,
  }, callback);
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

class PilotAdmissionBlock extends HttpError {
  constructor({ status, message, code }) {
    super(status, message);
    this.code = code;
  }
}

class GitHubError extends Error {
  constructor(status, message, { requestId = null, retryDelayMs = null } = {}) {
    super(message);
    this.status = status;
    this.requestId = requestId;
    this.retryDelayMs = retryDelayMs;
  }
}

export function githubRetryDelayMs(status, headers, attempt = 1, now = Date.now()) {
  const retryAfter = Number.parseFloat(headers?.get?.("retry-after") ?? "");
  if (Number.isFinite(retryAfter) && retryAfter >= 0) {
    return Math.min(60_000, Math.ceil(retryAfter * 1000));
  }
  if (headers?.get?.("x-ratelimit-remaining") === "0") {
    const resetAt = Number.parseInt(headers?.get?.("x-ratelimit-reset") ?? "", 10) * 1000;
    const delay = resetAt - now;
    return Number.isFinite(delay) && delay >= 0 && delay <= 60_000 ? delay : null;
  }
  if (status === 429) return 60_000;
  if (TRANSIENT_GITHUB_STATUSES.has(status)) return Math.min(5_000, 250 * (2 ** (attempt - 1)));
  return null;
}

function apiRequestId(req) {
  const incoming = header(req, "x-request-id");
  if (typeof incoming === "string" && /^[A-Za-z0-9._:-]{8,80}$/u.test(incoming)) return incoming;
  return randomBytes(12).toString("hex");
}

function applyApiHeaders(res, requestId) {
  res.setHeader("x-request-id", requestId);
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()");
}

function logApiRequest(level, fields) {
  if (process.env.VERCEL !== "1" && process.env.CHANGEPLANE_LOG_REQUESTS !== "true") return;
  const writer = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
  writer(JSON.stringify({
    timestamp: new Date().toISOString(),
    service: "changeplane-installer",
    ...fields,
  }));
}

function hasSourceProvenance() {
  return process.env.VERCEL !== "1" || (
    process.env.VERCEL_ENV === VERIFIED_VERCEL_SOURCE.environment
    && process.env.VERCEL_GIT_PROVIDER === VERIFIED_VERCEL_SOURCE.provider
    && process.env.VERCEL_GIT_REPO_OWNER === VERIFIED_VERCEL_SOURCE.owner
    && process.env.VERCEL_GIT_REPO_SLUG === VERIFIED_VERCEL_SOURCE.repository
    && process.env.VERCEL_GIT_COMMIT_REF === VERIFIED_VERCEL_SOURCE.branch
    && /^[a-f0-9]{40}$/u.test(process.env.VERCEL_GIT_COMMIT_SHA ?? "")
  );
}

function configuredCanaryRepository() {
  const value = process.env.CHANGEPLANE_CANARY_REPOSITORY;
  if (value == null || value === "") return null;
  try {
    return validateRepository(value);
  } catch {
    return null;
  }
}

function configuredAlphaRepositories() {
  const value = process.env.CHANGEPLANE_ALPHA_REPOSITORIES_JSON;
  if (value == null || value === "") return null;
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 5) return null;
    const repositories = parsed.map(validateRepository);
    if (new Set(repositories.map((repository) => repository.toLowerCase())).size !== repositories.length) {
      return null;
    }
    return repositories;
  } catch {
    return null;
  }
}

function currentReleaseBinding() {
  const sourceSha = process.env.VERCEL_GIT_COMMIT_SHA;
  if (/^[a-f0-9]{40}$/u.test(sourceSha ?? "")) return sourceSha;
  return process.env.VERCEL === "1" ? null : "development";
}

function legalReleaseApproved() {
  const releaseBinding = currentReleaseBinding();
  return process.env.CHANGEPLANE_LEGAL_RELEASE_APPROVED === "true"
    && releaseBinding !== null
    && process.env.CHANGEPLANE_LEGAL_RELEASE_APPROVED_RELEASE === releaseBinding;
}

function rolloutMode() {
  if (process.env.CHANGEPLANE_ALPHA_REPOSITORIES_JSON) return "private_alpha";
  if (process.env.CHANGEPLANE_SELF_SERVE_ENABLED === "true") return "self_serve";
  return process.env.CHANGEPLANE_CANARY_REPOSITORY || process.env.VERCEL === "1"
    ? "controlled_canary"
    : "self_serve";
}

function hasValidCanaryRepository() {
  if (rolloutMode() === "self_serve") return true;
  if (rolloutMode() === "private_alpha") return Boolean(configuredAlphaRepositories());
  return Boolean(configuredCanaryRepository());
}

function rolloutAccessBlock() {
  const mode = rolloutMode();
  if (mode === "controlled_canary" || (mode === "self_serve" && process.env.VERCEL !== "1")) return null;
  if (mode === "private_alpha" && !configuredAlphaRepositories()) {
    return {
      reason: "alpha_scope_required",
      message: "CHANGEPLANE_ALPHA_REPOSITORIES_JSON must contain the exact approved repository scope. No repository was accessed or changed.",
      nextAction: "Ask the release owner to finish the invited repository list.",
    };
  }
  if (!legalReleaseApproved()) {
    return {
      reason: "legal_release_required",
      message: "Customer access is paused until the legal pack is approved for this release. No repository was accessed or changed.",
      nextAction: "Ask the release owner to complete the release approval.",
    };
  }
  if (guardPrincipalSeparation() !== "separate_guard_app") {
    return {
      reason: "separate_guard_required",
      message: "Customer access requires a separate Guard GitHub App. No repository was accessed or changed.",
      nextAction: "Ask the release owner to finish Guard App setup.",
    };
  }
  if (!GUARD_PUBLICATION_SERIALIZED) {
    return {
      reason: "publication_serialization_required",
      message: "Customer access is paused because overlapping evaluations can publish Guard results out of order. No repository was accessed or changed.",
      nextAction: "Ask the release owner to complete and verify serialized Guard publication before customer activation.",
    };
  }
  if (mode === "self_serve" && !COMMERCIAL_RUNTIME_INTEGRATED) {
    return {
      reason: "commercial_runtime_required",
      message: "Public self-service is unavailable while usage recording and plan enforcement are incomplete. No repository was accessed or changed.",
      nextAction: "Ask the release owner about the founder-led private alpha.",
    };
  }
  return null;
}

function assertRolloutAccessAuthorized() {
  const block = rolloutAccessBlock();
  if (block) throw new HttpError(503, `${block.message} ${block.nextAction}`);
}

function allowedRolloutRepositories() {
  const mode = rolloutMode();
  if (mode === "self_serve") return null;
  if (mode === "private_alpha") return configuredAlphaRepositories();
  const canary = configuredCanaryRepository();
  return canary ? [canary] : null;
}

function assertRepositoryRolloutScope(repository, { external = false } = {}) {
  const allowed = allowedRolloutRepositories();
  if (rolloutMode() === "self_serve") return;
  if (!allowed) {
    const variable = rolloutMode() === "private_alpha"
      ? "CHANGEPLANE_ALPHA_REPOSITORIES_JSON"
      : "CHANGEPLANE_CANARY_REPOSITORY";
    throw new HttpError(503, `${variable} must contain the exact approved repository scope. No ${external ? "external" : "GitHub"} request was made.`);
  }
  if (!allowed.some((candidate) => candidate.toLowerCase() === repository.toLowerCase())) {
    throw new HttpError(403, rolloutMode() === "private_alpha"
      ? "This repository is outside the invite-only alpha allowlist. Nothing was changed."
      : "This release can access only its approved test repository. Choose the repository shown in the installer or ask the release owner to update CHANGEPLANE_CANARY_REPOSITORY. Nothing was changed.");
  }
}

function repairControllerConfiguration() {
  const canaryRepository = configuredCanaryRepository();
  const selfServe = rolloutMode() === "self_serve";
  let repository = null;
  try {
    repository = validateRepository(process.env.CHANGEPLANE_REPAIR_REPOSITORY ?? "");
  } catch {
    // A missing or invalid repository keeps repair fail-closed without affecting observe readiness.
  }
  const generation = Number(process.env.CHANGEPLANE_REPAIR_GENERATION);
  const enabled = process.env.CHANGEPLANE_REPAIR_ENABLED === "true";
  const checks = {
    enabled,
    repositoryScope: selfServe || Boolean(repository),
    installationBound: selfServe || Boolean(
      canaryRepository
      && repository
      && canaryRepository.toLowerCase() === repository.toLowerCase()
    ),
    appId: /^[1-9][0-9]{0,19}$/u.test(process.env.GITHUB_APP_ID ?? ""),
    appPrivateKey: typeof process.env.GITHUB_APP_PRIVATE_KEY === "string"
      && process.env.GITHUB_APP_PRIVATE_KEY.includes("PRIVATE KEY"),
    controllerSecret: typeof process.env.CHANGEPLANE_CONTROLLER_SECRET === "string"
      && process.env.CHANGEPLANE_CONTROLLER_SECRET.length >= 32,
    generation: Number.isSafeInteger(generation) && generation > 0,
  };
  const provisioningConfigured = Boolean(githubAppSlug())
    && Object.entries(checks).every(([name, value]) => name === "enabled" || value);
  return {
    enabled,
    configured: enabled && provisioningConfigured,
    provisioningConfigured,
    checks,
    generation,
    repository: selfServe ? null : repository,
    scope: selfServe ? "verified_installation" : "controlled_canary",
  };
}

function readiness() {
  const appSlug = githubAppSlug();
  const mode = rolloutMode();
  const sourceSha = process.env.VERCEL_GIT_COMMIT_SHA;
  const sourceProvenance = hasSourceProvenance();
  let journalConfigured = false;
  let journalConfigurationValid = true;
  try { journalConfigured = guardJournalConfiguration() !== null; } catch { journalConfigurationValid = false; }
  const operationalChecks = {
    githubClientId: Boolean(process.env.GITHUB_CLIENT_ID),
    githubClientSecret: Boolean(process.env.GITHUB_CLIENT_SECRET),
    githubAppSlug: mode !== "self_serve"
      ? Boolean(appSlug)
      : process.env.GITHUB_APP_SLUG == null || Boolean(appSlug),
    sessionSecret: typeof process.env.CHANGEPLANE_SESSION_SECRET === "string"
      && process.env.CHANGEPLANE_SESSION_SECRET.length >= 32,
    appOrigin: Boolean(configuredAppOrigin()),
    guardPublisher: guardPublisherIsConfigured(),
    sourceProvenance,
    canaryRepository: hasValidCanaryRepository(),
    rolloutAuthorized: rolloutAccessBlock() === null,
    guardJournalConfiguration: journalConfigurationValid,
    pilotAdmissionConfiguration: !pilotAdmissionRequested() || pilotAdmissionIsConfigured(),
  };
  const principalSeparation = guardPrincipalSeparation();
  const commercialStore = commercialStoreIsConfigured();
  const releaseBinding = currentReleaseBinding();
  const commercialStoreVerified = commercialStore
    && releaseBinding !== null
    && process.env.CHANGEPLANE_COMMERCIAL_STORE_VERIFIED_RELEASE === releaseBinding;
  const legalRelease = legalReleaseApproved();
  const checks = {
    ...operationalChecks,
    guardPrincipalSeparated: principalSeparation === "separate_guard_app",
    guardPublicationSerialized: GUARD_PUBLICATION_SERIALIZED,
    guardJournalConfigured: journalConfigured,
    commercialStore,
    commercialStoreVerified,
    commercialRuntimeIntegrated: COMMERCIAL_RUNTIME_INTEGRATED,
    legalRelease,
  };
  const ready = Object.values(operationalChecks).every(Boolean);
  return {
    ready,
    commercialReady: ready
      && checks.guardPrincipalSeparated
      && checks.guardPublicationSerialized
      && checks.commercialStoreVerified
      && checks.commercialRuntimeIntegrated
      && checks.legalRelease,
    principalSeparation,
    checks,
    authMode: appSlug ? "github_app" : "oauth",
    rolloutMode: mode,
    release: sourceSha?.slice(0, 12)
      || process.env.VERCEL_DEPLOYMENT_ID?.slice(0, 64)
      || "development",
    managedRuntime: process.env[MANAGED_API_KEY_NAME] ? "provider_configured" : "reserved",
    repairController: repairControllerConfiguration(),
  };
}

function assertExternalAccessSourceProvenance() {
  if (!hasSourceProvenance()) {
    throw new HttpError(503, "GitHub and OpenAI access is disabled until this deployment is bound to a verified source commit.");
  }
}

function secretKey(secret, purpose) {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("CHANGEPLANE_SESSION_SECRET must contain at least 32 characters.");
  }
  return createHash("sha256").update(`${purpose}\0${secret}`).digest();
}

function decodePart(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error("Invalid sealed value.");
  }
  return Buffer.from(value, "base64url");
}

export function seal(value, secret, {
  now = Date.now(),
  ttlMs = SESSION_TTL_MS,
  purpose = "session",
} = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Sealed value must be an object.");
  }
  if (!Number.isFinite(now) || !Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new TypeError("now and ttlMs must be valid positive numbers.");
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(secret, purpose), iv);
  cipher.setAAD(Buffer.from(`changeplane:${purpose}:v1`));
  const plaintext = Buffer.from(JSON.stringify({ ...value, iat: now, exp: now + ttlMs }));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return ["v1", iv.toString("base64url"), ciphertext.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}

export function unseal(token, secret, { now = Date.now(), purpose = "session" } = {}) {
  try {
    const [version, ivPart, ciphertextPart, tagPart, extra] = String(token ?? "").split(".");
    if (version !== "v1" || extra !== undefined) throw new Error("Invalid sealed value.");
    const iv = decodePart(ivPart);
    const ciphertext = decodePart(ciphertextPart);
    const tag = decodePart(tagPart);
    if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) throw new Error("Invalid sealed value.");

    const decipher = createDecipheriv("aes-256-gcm", secretKey(secret, purpose), iv);
    decipher.setAAD(Buffer.from(`changeplane:${purpose}:v1`));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const value = JSON.parse(plaintext.toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid sealed value.");
    if (!Number.isFinite(value.iat) || !Number.isFinite(value.exp) || value.exp <= now || value.iat > now + 60_000) {
      throw new Error("Sealed value expired.");
    }
    return value;
  } catch (error) {
    if (error instanceof Error && error.message === "Sealed value expired.") throw error;
    throw new Error("Invalid sealed value.");
  }
}

export function validateRepository(value) {
  if (typeof value !== "string" || value.length > 141) {
    throw new HttpError(400, "repository must be an owner/name string.");
  }
  const parts = value.trim().split("/");
  if (parts.length !== 2) throw new HttpError(400, "repository must be an owner/name string.");
  const [owner, repository] = parts;
  if (
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u.test(owner)
    || !/^[A-Za-z0-9_.-]{1,100}$/u.test(repository)
    || repository === "."
    || repository === ".."
  ) {
    throw new HttpError(400, "repository contains invalid GitHub characters.");
  }
  return `${owner}/${repository}`;
}

export function validateByokKey(value) {
  if (typeof value !== "string" || value.length < BYOK_MIN_LENGTH || value.length > BYOK_MAX_LENGTH
    || /[\s\u0000-\u001f\u007f]/u.test(value)) {
    throw new HttpError(400, "Enter a valid provider API key without spaces.");
  }
  return value;
}

export function validateRuntimeModel(value) {
  try {
    return proposalModel(value);
  } catch {
    throw new HttpError(400, "Choose GPT-5.6 Luna, Terra, or Sol.");
  }
}

export async function verifyOpenAIKey(value, { model = DEFAULT_PROPOSAL_MODEL, fetchImpl = fetch } = {}) {
  const apiKey = validateByokKey(value);
  const selectedModel = validateRuntimeModel(model);
  let response;
  try {
    response = await fetchImpl(`${OPENAI_MODELS_URL}/${encodeURIComponent(selectedModel)}`, {
      redirect: "error",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new HttpError(502, "OpenAI credential verification is temporarily unavailable. No secret was saved.");
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new HttpError(400, "OpenAI rejected this API key. No secret was saved.");
    }
    if (response.status === 404) {
      throw new HttpError(409, `${selectedModel} is not available for this OpenAI project. No secret was saved.`);
    }
    throw new HttpError(502, "OpenAI credential verification is temporarily unavailable. No secret was saved.");
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new HttpError(502, "OpenAI returned an invalid model response. No secret was saved.");
  }
  if (payload?.id !== selectedModel) {
    throw new HttpError(409, `${selectedModel} is not available for this OpenAI project. No secret was saved.`);
  }
  return { provider: RUNTIME_PROVIDER, model: selectedModel, verified: true };
}

function cookie(name, value, maxAge) {
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function clearCookie(name) {
  return cookie(name, "", 0);
}

function parseCookies(header) {
  return String(header ?? "").split(";").reduce((cookies, pair) => {
    const index = pair.indexOf("=");
    if (index < 1) return cookies;
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (name) cookies[name] = value;
    return cookies;
  }, {});
}

function header(req, name) {
  const value = req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function configuredOrigin(req) {
  const configured = process.env.CHANGEPLANE_APP_ORIGIN;
  if (configured) {
    const origin = configuredAppOrigin();
    if (!origin) throw new Error("CHANGEPLANE_APP_ORIGIN must be a public HTTPS origin without a path.");
    return origin;
  }

  const vercelHost = process.env.VERCEL_URL;
  if (vercelHost && /^[A-Za-z0-9.-]+$/u.test(vercelHost)) {
    return new URL(`https://${vercelHost}`).origin;
  }

  const host = header(req, "x-forwarded-host") ?? header(req, "host");
  if (!host || !/^[A-Za-z0-9.:-]+$/u.test(host)) throw new HttpError(400, "Unable to determine the public origin.");
  const protocol = header(req, "x-forwarded-proto") === "http" ? "http" : "https";
  return new URL(`${protocol}://${host}`).origin;
}

function configuredAppOrigin() {
  const value = process.env.CHANGEPLANE_APP_ORIGIN;
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.origin === value.replace(/\/$/u, "")
      ? parsed.origin
      : null;
  } catch {
    return null;
  }
}

function oauthIsConfigured() {
  const appSlug = githubAppSlug();
  return Boolean(
    process.env.GITHUB_CLIENT_ID
    && process.env.GITHUB_CLIENT_SECRET
    && typeof process.env.CHANGEPLANE_SESSION_SECRET === "string"
    && process.env.CHANGEPLANE_SESSION_SECRET.length >= 32
    && configuredAppOrigin()
    && guardPublisherIsConfigured()
    && (rolloutMode() === "self_serve" || appSlug)
    && (process.env.GITHUB_APP_SLUG == null || appSlug)
    && hasValidCanaryRepository()
    && rolloutAccessBlock() === null
  );
}

function githubAppSlug() {
  const value = process.env.GITHUB_APP_SLUG;
  if (value == null || value === "") return null;
  return /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/u.test(value) ? value : null;
}

function guardPublisherEnvironment() {
  if (process.env.CHANGEPLANE_GUARD_REUSE_GITHUB_APP === "true") {
    return {
      appId: process.env.GITHUB_APP_ID,
      appSlug: process.env.GITHUB_APP_SLUG,
      privateKey: process.env.GITHUB_APP_PRIVATE_KEY,
    };
  }
  return {
    appId: process.env.CHANGEPLANE_GUARD_APP_ID,
    appSlug: process.env.CHANGEPLANE_GUARD_APP_SLUG,
    privateKey: process.env.CHANGEPLANE_GUARD_APP_PRIVATE_KEY,
  };
}

function configuredGuardPublisher() {
  const environment = guardPublisherEnvironment();
  const appSlug = environment.appSlug;
  const appId = Number(environment.appId);
  if (
    typeof appSlug !== "string"
    || !/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/u.test(appSlug)
    || appSlug === "github-actions"
    || !Number.isSafeInteger(appId)
    || appId <= 0
  ) return null;
  return {
    appId,
    appSlug,
    trust: "DEDICATED_CHANGEPLANE_APP",
  };
}

function guardPublisherIsConfigured() {
  const publisher = configuredGuardPublisher();
  const { privateKey } = guardPublisherEnvironment();
  if (!publisher || typeof privateKey !== "string" || !privateKey.includes("PRIVATE KEY")) return false;
  try {
    const pem = privateKey.includes("\\n") && !privateKey.includes("\n")
      ? privateKey.replaceAll("\\n", "\n")
      : privateKey;
    const key = createPrivateKey(pem.trim());
    return key.asymmetricKeyType === "rsa"
      && (key.asymmetricKeyDetails?.modulusLength ?? 0) >= 2_048;
  } catch {
    return false;
  }
}

function guardPrincipalSeparation() {
  if (!guardPublisherIsConfigured()) return "guard_app_not_configured";
  if (process.env.CHANGEPLANE_GUARD_REUSE_GITHUB_APP === "true") {
    return "shared_installer_guard";
  }

  const guard = configuredGuardPublisher();
  const installerId = Number(process.env.GITHUB_APP_ID);
  const installerSlug = githubAppSlug();
  if (!Number.isSafeInteger(installerId) || installerId <= 0 || !installerSlug) {
    return "installer_app_not_configured";
  }
  if (guard?.appId === installerId || guard?.appSlug === installerSlug) {
    return "shared_installer_guard";
  }
  return "separate_guard_app";
}

function commercialStoreIsConfigured() {
  let reusesJournalLogin = false;
  try {
    const commercial = new URL(process.env.CHANGEPLANE_DATABASE_URL);
    const journal = new URL(process.env.CHANGEPLANE_GUARD_JOURNAL_DATABASE_URL);
    reusesJournalLogin = commercial.hostname.toLowerCase() === journal.hostname.toLowerCase()
      && (commercial.port || "5432") === (journal.port || "5432")
      // PostgreSQL login roles are cluster-wide, even across selected databases.
      && decodeURIComponent(commercial.username) === decodeURIComponent(journal.username);
  } catch { /* Missing or invalid URLs are handled by their own configuration gate. */ }
  return process.env.CHANGEPLANE_COMMERCIAL_STORE_ENABLED === "true"
    && verifiedPostgresUrl(process.env.CHANGEPLANE_DATABASE_URL) && !reusesJournalLogin;
}

export function assertOrigin(req) {
  const raw = header(req, "origin");
  let actual;
  try {
    actual = new URL(raw).origin;
  } catch {
    throw new HttpError(403, "A valid same-origin Origin header is required.");
  }
  if (raw !== actual || actual !== configuredOrigin(req)) {
    throw new HttpError(403, "Cross-origin mutation rejected.");
  }
}

function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left ?? ""));
  const b = Buffer.from(String(right ?? ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function assertCsrf(req, session) {
  if (!session?.csrf || !constantTimeEqual(header(req, "x-changeplane-csrf"), session.csrf)) {
    throw new HttpError(403, "Invalid CSRF token.");
  }
}

function sessionSecret() {
  return process.env.CHANGEPLANE_SESSION_SECRET ?? "";
}

function readSession(req) {
  const token = parseCookies(header(req, "cookie"))[SESSION_COOKIE];
  if (!token) return null;
  try {
    const session = unseal(token, sessionSecret());
    if (
      session.kind !== "session"
      || typeof session.token !== "string"
      || !session.token
      || typeof session.login !== "string"
      || typeof session.csrf !== "string"
    ) return null;
    const authMode = session.authMode === "github_app" ? "github_app" : "oauth";
    const configuredAuthMode = githubAppSlug() ? "github_app" : "oauth";
    if (authMode !== configuredAuthMode) return null;
    if (authMode === "github_app") {
      const sourceIds = Array.isArray(session.installationIds)
        ? session.installationIds
        : [session.installationId];
      const installationIds = [...new Set(sourceIds
        .map((value) => String(value ?? ""))
        .filter((value) => /^[1-9][0-9]{0,19}$/u.test(value)))]
        .slice(0, MAX_APP_INSTALLATIONS);
      if (installationIds.length === 0) return null;
      return { ...session, authMode, installationId: installationIds[0], installationIds };
    }
    return { ...session, authMode };
  } catch {
    return null;
  }
}

function requireSession(req) {
  const session = readSession(req);
  if (!session) throw new HttpError(401, "Connect GitHub first.");
  return session;
}

async function github(pathname, token, { method = "GET", body, headers = {}, expectJson = true } = {}) {
  const attempts = method === "GET" ? GITHUB_MAX_GET_ATTEMPTS : 1;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`https://api.github.com${pathname}`, {
        method,
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token}`,
          "user-agent": "changeplane-installer/0.2",
          "x-github-api-version": API_VERSION,
          ...(body ? { "content-type": "application/json" } : {}),
          ...headers,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) {
        if (response.status === 204 || !expectJson) return null;
        return response.json();
      }

      const requestId = response.headers?.get?.("x-github-request-id") || null;
      const retryDelayMs = githubRetryDelayMs(response.status, response.headers, attempt);
      const error = new GitHubError(response.status, `GitHub rejected the request (${response.status}).`, { requestId, retryDelayMs });
      if (retryDelayMs == null || retryDelayMs > SERVERLESS_MAX_RETRY_DELAY_MS || attempt === attempts) throw error;
      lastError = error;
    } catch (error) {
      if (error instanceof GitHubError
        && (error.retryDelayMs == null || error.retryDelayMs > SERVERLESS_MAX_RETRY_DELAY_MS || attempt === attempts)) throw error;
      if (attempt === attempts) throw error;
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, lastError?.retryDelayMs ?? Math.min(5_000, 250 * (2 ** (attempt - 1)))));
  }
  throw lastError;
}

async function githubPathExists(repository, filePath, ref, token) {
  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  try {
    await github(`/repos/${repository}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`, token);
    return true;
  } catch (error) {
    if (error instanceof GitHubError && error.status === 404) return false;
    throw error;
  }
}

async function installationRepositories(session) {
  const installationIds = session.installationIds ?? [session.installationId];
  const repositories = new Map();
  for (const installationId of installationIds.slice(0, MAX_APP_INSTALLATIONS)) {
    for (let page = 1; page <= 10; page += 1) {
      const payload = await github(`/user/installations/${encodeURIComponent(installationId)}/repositories?per_page=100&page=${page}`, session.token);
      const batch = payload?.repositories;
      if (!Array.isArray(batch)) throw new HttpError(502, "GitHub returned an invalid repository list.");
      for (const repository of batch) {
        if (typeof repository?.full_name !== "string") continue;
        const key = repository.full_name.toLowerCase();
        if (!repositories.has(key)) {
          repositories.set(key, { ...repository, changeplaneInstallationId: installationId });
        }
        if (repositories.size >= MAX_INSTALLATION_REPOSITORIES) break;
      }
      if (batch.length < 100 || repositories.size >= MAX_INSTALLATION_REPOSITORIES) break;
    }
    if (repositories.size >= MAX_INSTALLATION_REPOSITORIES) break;
  }
  return [...repositories.values()];
}

async function requireWritableRepository(repository, session) {
  assertRepositoryRolloutScope(repository);
  const encodedRepository = encodeRepository(repository);
  const repo = session.authMode === "github_app"
    ? (await installationRepositories(session)).find((candidate) => candidate?.full_name?.toLowerCase() === repository.toLowerCase())
    : await github(`/repos/${encodedRepository}`, session.token);
  if (repo?.full_name?.toLowerCase() !== repository.toLowerCase()) {
    throw new HttpError(404, "Repository not found.");
  }
  if (!repo.permissions?.push && !repo.permissions?.admin) {
    throw new HttpError(403, "Push or admin repository access is required.");
  }
  return {
    encodedRepository,
    repo,
    installationId: session.authMode === "github_app" ? repo.changeplaneInstallationId : null,
  };
}

async function requireRepositoryAdmin(repository, session) {
  const target = await requireWritableRepository(repository, session);
  const live = await github(`/repos/${target.encodedRepository}`, session.token);
  if (live?.full_name?.toLowerCase() !== repository.toLowerCase()) {
    throw new HttpError(404, "Repository not found.");
  }
  if (live.permissions?.admin !== true) {
    throw new HttpError(403, "Repository admin access is required before ChangePlane can manage Actions Secrets.");
  }
  return { ...target, repo: { ...target.repo, ...live } };
}

async function revalidateRepositoryAdmin(target, repository, session) {
  const live = await github(`/repos/${target.encodedRepository}`, session.token);
  if (live?.full_name?.toLowerCase() !== repository.toLowerCase()
    || !Number.isSafeInteger(live?.id)
    || live.id < 1
    || (Number.isSafeInteger(target.repo?.id) && live.id !== target.repo.id)
    || live.permissions?.admin !== true) {
    throw new HttpError(403, "Repository admin access changed before the protected operation. Nothing was changed; reconnect as an administrator and retry.");
  }
  return { ...target, repo: { ...target.repo, ...live } };
}

export function validateAutonomousBranchProtection(requiredStatusChecks) {
  if (requiredStatusChecks?.active !== true
    || requiredStatusChecks?.strict !== true
    || requiredStatusChecks?.mergeQueueRequired !== true
    || requiredStatusChecks?.guardRequired !== true
    || requiredStatusChecks?.publisherBound !== true
    || requiredStatusChecks?.evidenceRequired !== true
    || requiredStatusChecks?.evidencePublisherBound !== true) {
    throw new HttpError(
      409,
      "Autonomous repair requires one verified no-bypass GitHub merge gate with the dedicated-App guard and every behavioral evidence Check bound to its expected publisher. Complete the repository ruleset, then retry. Verify Lite remains available.",
    );
  }
  return true;
}

async function enforcementPublisherAppIdentities(encodedRepository, repo, token, requiredChecks) {
  const expectedPublisher = configuredGuardPublisher();
  if (!expectedPublisher) return { guard: null, evidence: [] };
  const requirements = validateRequiredChecks(requiredChecks, { mode: "enforce" });
  const pulls = await github(
    `/repos/${encodedRepository}/pulls?state=open&base=${encodeURIComponent(repo.default_branch)}&sort=updated&direction=desc&per_page=3`,
    token,
  );
  if (!Array.isArray(pulls)) throw new Error("GitHub returned an invalid pull request list.");
  const candidateHeads = [...new Set(pulls
    .filter((pull) => pull?.head?.repo?.full_name === repo.full_name && /^[a-f0-9]{40}$/u.test(pull?.head?.sha ?? ""))
    .map((pull) => pull.head.sha))].slice(0, 3);
  const payloads = await Promise.all(candidateHeads.map(async (headSha) => ({
    headSha,
    payload: await github(
      `/repos/${encodedRepository}/commits/${headSha}/check-runs?filter=latest&per_page=100`,
      token,
    ),
  })));
  let guard = null;
  const observedEvidence = new Map(requirements.map((requirement) => [requirement.name, new Set()]));
  const runCache = new Map();
  for (const { headSha, payload } of payloads) {
    if (!Array.isArray(payload?.check_runs) || payload.check_runs.length >= 100) {
      throw new Error("GitHub returned an incomplete or invalid Check Run list.");
    }
    const guardRun = payload.check_runs.find((check) => check?.head_sha === headSha
      && check?.name === GUARD_CHECK_NAME
      && check?.app?.slug === expectedPublisher.appSlug
      && check?.app?.id === expectedPublisher.appId);
    if (guardRun) guard = expectedPublisher.appId;
    for (const requirement of requirements) {
      for (const check of payload.check_runs.filter((candidate) => (
        candidate?.head_sha === headSha
        && candidate?.name === requirement.name
        && candidate?.app?.slug === requirement.appSlug
        && Number.isSafeInteger(candidate?.app?.id)
        && candidate.app.id > 0
      ))) {
        const provenanceMatches = requirement.appSlug !== "github-actions"
          || await githubActionsWorkflowMatches({
            encodedRepository,
            repository: repo.full_name,
            headSha,
            check,
            workflowPath: requirement.workflowPath,
            token,
            runCache,
          });
        if (provenanceMatches) observedEvidence.get(requirement.name).add(check.app.id);
      }
    }
  }
  return {
    guard,
    evidence: requirements.map(({ name }) => {
      const identities = [...observedEvidence.get(name)];
      return { name, integrationId: identities.length === 1 ? identities[0] : null };
    }),
  };
}

async function readRepositoryRulesets(encodedRepository, token) {
  let summaries;
  try {
    summaries = await github(
      `/repos/${encodedRepository}/rulesets?includes_parents=true&per_page=100`,
      token,
    );
  } catch (error) {
    if (error instanceof GitHubError && error.status === 404) return [];
    throw error;
  }
  if (!Array.isArray(summaries) || summaries.length > 25) return null;
  const ids = summaries.map(({ id }) => id);
  if (ids.some((id) => !Number.isSafeInteger(id) || id < 1)) return null;
  return Promise.all(ids.map((id) => github(`/repos/${encodedRepository}/rulesets/${id}`, token)));
}

async function readGuardEnforcement(encodedRepository, repo, token, { isAdmin, requiredChecks = [] }) {
  if (!isAdmin) {
    return {
      source: "unverified",
      state: "admin_required",
      assuranceLevel: null,
      active: false,
      queueCertified: false,
      strict: false,
      guardRequired: false,
      publisherBound: false,
      mergeQueueRequired: false,
      evidenceRequired: false,
      evidencePublisherBound: false,
    };
  }
  try {
    const rulesets = await readRepositoryRulesets(encodedRepository, token);
    if (rulesets === null) throw new HttpError(409, "GitHub Ruleset readiness is ambiguous.");
    const publishers = await enforcementPublisherAppIdentities(
      encodedRepository,
      repo,
      token,
      requiredChecks,
    );
    if (publishers.guard == null) {
      return {
        source: "ruleset",
        state: "guard_run_required",
        assuranceLevel: null,
        active: false,
        queueCertified: false,
        strict: false,
        mergeQueueRequired: false,
        guardRequired: false,
        publisherBound: false,
        evidenceRequired: false,
        evidencePublisherBound: false,
        nextAction: "Run ChangePlane on one unique pull-request head so GitHub records the dedicated-App guard publisher, then recheck.",
      };
    }
    const missingEvidencePublisher = publishers.evidence.find(({ integrationId }) => integrationId == null);
    if (missingEvidencePublisher) return {
      source: "ruleset",
      state: "evidence_run_required",
      assuranceLevel: null,
      active: false,
      queueCertified: false,
      strict: false,
      mergeQueueRequired: false,
      guardRequired: false,
      publisherBound: true,
      evidenceRequired: false,
      evidencePublisherBound: false,
      nextAction: `Run ${missingEvidencePublisher.name} from its configured workflow and publisher on a pull request, then recheck.`,
    };
    return githubRulesetReadiness(rulesets, {
      defaultBranch: repo.default_branch,
      guardCheckName: GUARD_CHECK_NAME,
      publisherIntegrationId: publishers.guard,
      evidenceChecks: publishers.evidence,
      repositoryScoped: true,
    });
  } catch (error) {
    if ((error instanceof GitHubError && [403, 422].includes(error.status)) || error instanceof HttpError) {
      return {
        source: "ruleset",
        state: "ruleset_ambiguous",
        assuranceLevel: null,
        active: false,
        queueCertified: false,
        strict: false,
        mergeQueueRequired: false,
        guardRequired: false,
        publisherBound: false,
        evidenceRequired: false,
        evidencePublisherBound: false,
        nextAction: "Grant Ruleset Administration access, resolve ambiguous or bypass-bearing policy, then review a fresh Strict Head or Queue Certified plan.",
      };
    }
    throw error;
  }
}

async function requireAutonomousBranchProtection(encodedRepository, repo, token) {
  if (typeof repo?.default_branch !== "string" || !repo.default_branch) {
    throw new HttpError(409, "Repository has no default branch.");
  }
  const runtime = await readRepositoryRuntime(encodedRepository, repo, token);
  const enforcement = await readGuardEnforcement(encodedRepository, repo, token, {
    isAdmin: true,
    requiredChecks: runtime.requiredChecks,
  });
  validateAutonomousBranchProtection(enforcement);
  return enforcement;
}

async function inspectInstallTarget(repository, session) {
  const { encodedRepository, repo } = await requireWritableRepository(repository, session);
  if (typeof repo.default_branch !== "string" || !repo.default_branch) {
    throw new HttpError(409, "Repository has no default branch.");
  }

  const baseRef = await github(`/repos/${encodedRepository}/git/ref/heads/${encodeRef(repo.default_branch)}`, session.token);
  const baseSha = baseRef?.object?.sha;
  if (!/^[a-f0-9]{40}$/u.test(baseSha ?? "")) throw new Error("GitHub returned an invalid default-branch revision.");
  const reservedPaths = (await Promise.all(MANAGED_RESERVED_PATHS.map(async (filePath) => (
    await githubPathExists(encodedRepository, filePath, baseSha, session.token) ? filePath : null
  )))).filter(Boolean);
  const installation = reservedPaths.length === 0
    ? { state: "fresh", currentVersion: null, targetVersion: MANAGED_VERSION, conflicts: [] }
    : await inspectManagedInstallation(encodedRepository, baseSha, session.token);
  if (installation.policyMigration?.required) {
    installation.policyMigration.ownerAuthorized = repo.permissions?.admin === true;
  }
  const conflicts = installation.conflicts;
  const repositoryState = repo.archived ? "archived" : repo.disabled ? "disabled" : "active";
  const migrationOwnerAuthorized = installation.policyMigration?.required !== true
    || installation.policyMigration.ownerAuthorized;
  return {
    encodedRepository,
    repo,
    baseSha,
    conflicts,
    installation,
    repositoryState,
    installable: repositoryState === "active"
      && migrationOwnerAuthorized
      && ["fresh", "outdated"].includes(installation.state),
  };
}

const GITHUB_WORKFLOW_PATH = /^\.github\/workflows\/[^/\\\u0000-\u001f\u007f]{1,260}\.ya?ml$/u;

function validGithubWorkflowPath(value) {
  return typeof value === "string"
    && value.length <= 300
    && value === value.trim()
    && GITHUB_WORKFLOW_PATH.test(value);
}

function validateRequiredCheck(value, { requireWorkflowPath = false } = {}) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "requiredCheck must contain one GitHub check name and publisher.");
  }
  if (Object.keys(value).some((key) => !["name", "appSlug", "workflowPath"].includes(key))) {
    throw new HttpError(400, "requiredCheck must contain only name, appSlug, and an optional workflowPath.");
  }
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const appSlug = typeof value.appSlug === "string" ? value.appSlug.trim() : "";
  if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/u.test(name)
    || RESERVED_CHANGEPLANE_CHECK_NAMES.has(name)) {
    throw new HttpError(400, `Required check name must be 1–100 visible characters and cannot be ${GUARD_CHECK_NAME}, ${GUARD_EVALUATION_CHECK_NAME}, or ${REVIEW_CHECK_NAME}.`);
  }
  if (!/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/u.test(appSlug)) {
    throw new HttpError(400, "Required check publisher must be a valid GitHub App slug.");
  }
  const workflowPath = value.workflowPath == null
    ? null
    : typeof value.workflowPath === "string" ? value.workflowPath.trim() : "";
  if (appSlug === "github-actions") {
    if (workflowPath != null && !validGithubWorkflowPath(workflowPath)) {
      throw new HttpError(400, "A github-actions check must use an exact .github/workflows/*.yml or *.yaml workflowPath.");
    }
    if (requireWorkflowPath && !workflowPath) {
      throw new HttpError(400, "Verify and Autonomous modes require the exact github-actions workflowPath.");
    }
  } else if (workflowPath != null) {
    throw new HttpError(400, "workflowPath is allowed only for checks published by github-actions.");
  }
  return { name, appSlug, ...(workflowPath ? { workflowPath } : {}) };
}

export function classifyUpgradePolicyMigration(value) {
  let policy;
  try {
    policy = JSON.parse(value);
  } catch {
    return null;
  }
  if (!policy || typeof policy !== "object" || Array.isArray(policy) || policy.version !== 1) return null;
  let harness;
  try {
    harness = harnessPolicy(policy.harness);
  } catch {
    return null;
  }
  if (![HARNESS_MODE.VERIFY, HARNESS_MODE.AUTONOMOUS].includes(harness.mode)) return null;
  const requiredChecks = policy?.evidence?.requiredChecks;
  const missingGithubActionsWorkflow = !Array.isArray(requiredChecks)
    || requiredChecks.length === 0
    || requiredChecks.some((requirement) => (
      typeof requirement === "string"
      || (requirement?.appSlug === "github-actions" && !validGithubWorkflowPath(requirement.workflowPath))
    ));
  if (!missingGithubActionsWorkflow) return null;
  return {
    required: true,
    reason: "github_actions_workflow_path_required",
    previousHarnessMode: harness.mode,
    defaultHarnessMode: HARNESS_MODE.VERIFY,
    allowedHarnessModes: [HARNESS_MODE.VERIFY, HARNESS_MODE.OBSERVE],
    policyIncluded: true,
    ownerSelectionRequired: true,
    autonomousCredentialsProvisioned: false,
    legacyGuardPolicyAction: "replace_with_dedicated_app_guard",
  };
}

export function buildUpgradeRecoveryPolicy(value, requiredCheck = null, harnessMode = undefined) {
  const migration = classifyUpgradePolicyMigration(value);
  if (!migration) throw new HttpError(409, "The repository policy does not require the v13 evidence recovery migration.");
  const selectedMode = harnessMode == null ? HARNESS_MODE.VERIFY : harnessPolicy({ mode: harnessMode }).mode;
  if (!migration.allowedHarnessModes.includes(selectedMode)) {
    throw new HttpError(400, "A v11/v12 evidence recovery cannot retain Autonomous repair. Choose Verify only, or explicitly choose scope-only Observe.");
  }
  if (selectedMode === HARNESS_MODE.OBSERVE && requiredCheck != null) {
    throw new HttpError(400, "Scope-only Observe must not include a behavioral required Check.");
  }
  const selectedCheck = selectedMode === HARNESS_MODE.VERIFY
    ? validateRequiredCheck(requiredCheck, { requireWorkflowPath: true })
    : null;
  if (selectedMode === HARNESS_MODE.VERIFY && !selectedCheck) {
    throw new HttpError(400, "The v13 recovery defaults to Verify only and requires one owner-selected exact behavioral Check and publisher. GitHub Actions evidence also requires its exact workflowPath.");
  }
  const policy = JSON.parse(value);
  return `${JSON.stringify({
    ...policy,
    evidence: {
      ...(policy.evidence && typeof policy.evidence === "object" && !Array.isArray(policy.evidence)
        ? policy.evidence
        : {}),
      requiredChecks: selectedCheck ? [selectedCheck] : [],
      timeoutSeconds: selectedCheck ? 120 : 0,
    },
    harness: harnessPolicy({ mode: selectedMode }),
  }, null, 2)}\n`;
}

function harnessModeLabel(mode) {
  return mode === HARNESS_MODE.VERIFY
    ? "Verify only"
    : mode === HARNESS_MODE.AUTONOMOUS ? "Autonomous" : "Observe";
}

function validateManagedProfile(value = MANAGED_PROFILE.FULL) {
  if (!Object.values(MANAGED_PROFILE).includes(value)) {
    throw new TypeError("The managed payload profile must be verify-lite or full.");
  }
  return value;
}

function managedProfileForHarness(harnessMode) {
  return harnessPolicy({ mode: harnessMode }).mode === HARNESS_MODE.AUTONOMOUS
    ? MANAGED_PROFILE.FULL
    : MANAGED_PROFILE.VERIFY_LITE;
}

function contentDigest(content) {
  return createHash("sha256").update(content).digest("hex");
}

function gitBlobDigest(content) {
  return createHash("sha1")
    .update(`blob ${Buffer.byteLength(content)}\0`)
    .update(content)
    .digest("hex");
}

function isManagedReservedFile(filePath) {
  return typeof filePath === "string" && (
    filePath.startsWith("changeplane/")
    || filePath === POLICY_PATH
    || filePath === ASSURANCE_MEMORY_PATH
    || filePath === ".github/workflows/changeplane.yml"
    || filePath === ".github/workflows/changeplane-repair.yml"
  );
}

function managedManifestFromHashes(managedVersion, managedHashes, managedProfile = MANAGED_PROFILE.FULL) {
  const profile = validateManagedProfile(managedProfile);
  return `${JSON.stringify({
    schemaVersion: managedVersion >= 13 ? 2 : 1,
    managedVersion,
    ...(managedVersion >= 13 ? { managedProfile: profile } : {}),
    managedFiles: managedHashes,
  }, null, 2)}\n`;
}

function managedManifestContent(managedFiles, managedProfile) {
  return managedManifestFromHashes(MANAGED_VERSION, Object.fromEntries(managedFiles.map(({ path: filePath, content }) => (
    [filePath, contentDigest(content)]
  ))), managedProfile);
}

function buildManagedFiles(managedProfile = MANAGED_PROFILE.FULL) {
  const profile = validateManagedProfile(managedProfile);
  const reconciliationJob = `
  reconcile:
    name: ChangePlane guard reconciliation
    if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    permissions:
      contents: read
      id-token: write
    steps:
      - name: Use the pinned Node.js runtime
        # actions/setup-node v4.4.0
        uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version: 22.18.0
      - name: Check out the trusted default branch
        # actions/checkout v4.2.2; this job never executes pull-request code.
        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
        with:
          ref: \${{ github.event.repository.default_branch }}
          persist-credentials: false
      - name: Bind the trusted controller revision
        id: controller
        run: echo "sha=$(git rev-parse HEAD)" >> "$GITHUB_OUTPUT"
      - name: Reconcile stale App-owned Guards
        id: reconcile
        uses: ./changeplane
        with:
          operation: reconcile
          token: \${{ github.token }}
          trusted_controller_sha: \${{ steps.controller.outputs.sha }}
      - name: Surface timed-out evaluations for workflow notifications
        if: steps.reconcile.outputs.decision == 'ACTION_REQUIRED'
        run: |
          echo "A timed-out ChangePlane evaluation was closed safely. Inspect the Guard and re-run its evaluation on the same revision." >&2
          exit 1
`;

  const workflow = `name: ChangePlane

on:
  pull_request_target:
    types: [opened, synchronize, reopened, edited]
  pull_request_review:
    types: [submitted, dismissed]
  merge_group:
    types: [checks_requested]
  deployment_status:
  repository_dispatch:
    types: [changeplane_recheck]
  schedule:
    - cron: "*/5 * * * *"
  workflow_dispatch:

permissions:
  actions: read
  checks: read
  id-token: write
  pull-requests: write
  contents: read
  deployments: read
  statuses: read

concurrency:
  group: changeplane-pr-\${{ github.event_name == 'schedule' && 'reconcile' || github.event_name == 'workflow_dispatch' && 'reconcile' || github.event.pull_request.number || github.event.client_payload.pullRequestNumber || github.event.merge_group.head_sha || github.event.deployment.sha || github.run_id }}
  cancel-in-progress: true

jobs:
  guard:
    name: ChangePlane guard
    if: github.event_name != 'schedule' && github.event_name != 'workflow_dispatch'
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    steps:
      - name: Use the pinned Node.js runtime
        # actions/setup-node v4.4.0
        uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version: 22.18.0
      - name: Check out trusted base revision
        # actions/checkout v4.2.2; keep the trusted checkout immutable.
        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
        with:
          ref: \${{ github.event.merge_group.base_sha || (github.event.pull_request.base.ref == github.event.repository.default_branch && github.event.pull_request.base.sha) || github.event.repository.default_branch }}
          persist-credentials: false
      - name: Bind the trusted controller revision
        id: controller
        run: echo "sha=$(git rev-parse HEAD)" >> "$GITHUB_OUTPUT"
      - name: Read the trusted harness policy
        id: harness
        env:
          CHANGEPLANE_TRUSTED_POLICY: .changeplane.json
        run: node changeplane/src/lib/harness.js
      - name: Observe the exact revision
        if: github.event_name != 'merge_group' && steps.harness.outputs.mode == 'observe'
        uses: ./changeplane
        with:
          token: \${{ github.token }}
          mode: observe
          trusted_controller_sha: \${{ steps.controller.outputs.sha }}
      - name: Verify the exact revision without repair authority
        if: github.event_name != 'merge_group' && steps.harness.outputs.mode == 'enforce' && steps.harness.outputs.dispatch == 'none'
        uses: ./changeplane
        with:
          token: \${{ github.token }}
          mode: enforce
          trusted_controller_sha: \${{ steps.controller.outputs.sha }}
          agent_dispatch: none
      - name: Run the autonomous exact-revision harness
        if: github.event_name != 'merge_group' && steps.harness.outputs.mode == 'enforce' && steps.harness.outputs.dispatch == 'webhook'
        uses: ./changeplane
        with:
          token: \${{ github.token }}
          mode: enforce
          trusted_controller_sha: \${{ steps.controller.outputs.sha }}
          agent_dispatch: \${{ steps.harness.outputs.dispatch }}
          agent_webhook_url: https://changeplane.vercel.app/api/github?action=repair
          agent_webhook_token: \${{ secrets.CHANGEPLANE_CONTROLLER_HMAC_V12 }}
          controller_installation_id: \${{ secrets.CHANGEPLANE_CONTROLLER_INSTALLATION_ID }}
          max_remediation_attempts: \${{ steps.harness.outputs.max_attempts }}
      - name: Evaluate the merge queue without repair authority
        if: github.event_name == 'merge_group'
        uses: ./changeplane
        with:
          token: \${{ github.token }}
          mode: \${{ steps.harness.outputs.mode }}
          trusted_controller_sha: \${{ steps.controller.outputs.sha }}
          agent_dispatch: none

${reconciliationJob}
  review_propose:
    name: Independent review proposal
    if: github.event_name == 'pull_request_target'
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    permissions:
      contents: read
      pull-requests: read
    outputs:
      review_job: \${{ steps.propose.outputs.review_job }}
    steps:
      - name: Use the pinned Node.js runtime
        # actions/setup-node v4.4.0
        uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version: 22.18.0
      - name: Check out the trusted review controller
        # actions/checkout v4.2.2; never execute pull-request code here.
        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
        with:
          ref: \${{ (github.event.pull_request.base.ref == github.event.repository.default_branch && github.event.pull_request.base.sha) || github.event.repository.default_branch }}
          persist-credentials: false
      - name: Bind the trusted review controller revision
        id: controller
        run: echo "sha=$(git rev-parse HEAD)" >> "$GITHUB_OUTPUT"
      - name: Read the trusted review profile
        id: harness
        env:
          CHANGEPLANE_TRUSTED_POLICY: .changeplane.json
        run: node changeplane/src/lib/harness.js
      - name: Propose changed-line findings
        id: propose
        if: steps.harness.outputs.mode != 'enforce' || steps.harness.outputs.dispatch == 'webhook'
        env:
          CHANGEPLANE_TRUSTED_POLICY: .changeplane.json
          CHANGEPLANE_TRUSTED_CONTROLLER_SHA: \${{ steps.controller.outputs.sha }}
          GITHUB_TOKEN: \${{ github.token }}
          OPENAI_API_KEY: \${{ secrets.OPENAI_API_KEY }}
        run: node changeplane/examples/changeplane-review-run.js propose

  review_publish:
    name: Independent review receipt
    needs: review_propose
    if: always() && github.event_name == 'pull_request_target' && needs.review_propose.result == 'success' && needs.review_propose.outputs.review_job != ''
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    permissions:
      checks: write
      contents: read
      pull-requests: read
    steps:
      - name: Use the pinned Node.js runtime
        # actions/setup-node v4.4.0
        uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version: 22.18.0
      - name: Check out the trusted review publisher
        # actions/checkout v4.2.2; this job receives no model credential.
        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
        with:
          ref: \${{ (github.event.pull_request.base.ref == github.event.repository.default_branch && github.event.pull_request.base.sha) || github.event.repository.default_branch }}
          persist-credentials: false
      - name: Bind the trusted review publisher revision
        id: controller
        run: echo "sha=$(git rev-parse HEAD)" >> "$GITHUB_OUTPUT"
      - name: Revalidate and publish the advisory Check
        id: publish
        env:
          CHANGEPLANE_REVIEW_JOB: \${{ needs.review_propose.outputs.review_job }}
          CHANGEPLANE_TRUSTED_CONTROLLER_SHA: \${{ steps.controller.outputs.sha }}
          GITHUB_TOKEN: \${{ github.token }}
        run: node changeplane/examples/changeplane-review-run.js publish
`;
  const managedFiles = [
    { path: "changeplane/action.yml", content: readFileSync(path.join(ROOT, "action.yml"), "utf8") },
    { path: "changeplane/action/index.js", content: readFileSync(path.join(ROOT, "action/index.js"), "utf8") },
    { path: "changeplane/src/lib/changeplane.js", content: readFileSync(path.join(ROOT, "src/lib/changeplane.js"), "utf8") },
    { path: "changeplane/src/lib/harness.js", content: readFileSync(path.join(ROOT, "src/lib/harness.js"), "utf8") },
    { path: "changeplane/src/lib/review.js", content: readFileSync(path.join(ROOT, "src/lib/review.js"), "utf8") },
    { path: "changeplane/src/lib/runtime.js", content: readFileSync(path.join(ROOT, "src/lib/runtime.js"), "utf8") },
    { path: "changeplane/server/github-repair-controller.js", content: readFileSync(path.join(ROOT, "server/github-repair-controller.js"), "utf8") },
    { path: "changeplane/server/repair-ledger.js", content: readFileSync(path.join(ROOT, "server/repair-ledger.js"), "utf8") },
    { path: "changeplane/examples/changeplane-claim.js", content: readFileSync(path.join(ROOT, "examples/changeplane-claim.js"), "utf8") },
    { path: "changeplane/examples/changeplane-grant.js", content: readFileSync(path.join(ROOT, "examples/changeplane-grant.js"), "utf8") },
    { path: "changeplane/examples/changeplane-evidence-policy.js", content: readFileSync(path.join(ROOT, "examples/changeplane-evidence-policy.js"), "utf8") },
    { path: "changeplane/examples/changeplane-proposal.js", content: readFileSync(path.join(ROOT, "examples/changeplane-proposal.js"), "utf8") },
    { path: "changeplane/examples/changeplane-provider-openai.js", content: readFileSync(path.join(ROOT, "examples/changeplane-provider-openai.js"), "utf8") },
    { path: "changeplane/examples/changeplane-review-openai.js", content: readFileSync(path.join(ROOT, "examples/changeplane-review-openai.js"), "utf8") },
    { path: "changeplane/examples/changeplane-review-run.js", content: readFileSync(path.join(ROOT, "examples/changeplane-review-run.js"), "utf8") },
    // The vendored ESM action must work even when the host repository is CommonJS.
    { path: "changeplane/package.json", content: `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n` },
    { path: ".github/workflows/changeplane.yml", content: workflow },
    { path: ".github/workflows/changeplane-repair.yml", content: readFileSync(path.join(ROOT, "examples/changeplane-repair.yml"), "utf8") },
  ];

  if (profile === MANAGED_PROFILE.FULL) return managedFiles;

  const verifyLiteWorkflow = `name: ChangePlane

on:
  pull_request_target:
    types: [opened, synchronize, reopened, edited]
  pull_request_review:
    types: [submitted, dismissed]
  merge_group:
    types: [checks_requested]
  deployment_status:
  repository_dispatch:
    types: [changeplane_recheck]
  schedule:
    - cron: "*/5 * * * *"
  workflow_dispatch:

permissions:
  actions: read
  checks: read
  id-token: write
  pull-requests: write
  contents: read
  deployments: read
  statuses: read

concurrency:
  group: changeplane-pr-\${{ github.event_name == 'schedule' && 'reconcile' || github.event_name == 'workflow_dispatch' && 'reconcile' || github.event.pull_request.number || github.event.client_payload.pullRequestNumber || github.event.merge_group.head_sha || github.event.deployment.sha || github.run_id }}
  cancel-in-progress: true

jobs:
  guard:
    name: ChangePlane guard
    if: github.event_name != 'schedule' && github.event_name != 'workflow_dispatch'
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    steps:
      - name: Use the pinned Node.js runtime
        # actions/setup-node v4.4.0
        uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version: 22.18.0
      - name: Check out trusted base revision
        # actions/checkout v4.2.2; keep the trusted checkout immutable.
        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
        with:
          ref: \${{ github.event.merge_group.base_sha || (github.event.pull_request.base.ref == github.event.repository.default_branch && github.event.pull_request.base.sha) || github.event.repository.default_branch }}
          persist-credentials: false
      - name: Bind the trusted controller revision
        id: controller
        run: echo "sha=$(git rev-parse HEAD)" >> "$GITHUB_OUTPUT"
      - name: Read the trusted harness policy
        id: harness
        env:
          CHANGEPLANE_TRUSTED_POLICY: .changeplane.json
        run: node changeplane/src/lib/harness.js
      - name: Evaluate the exact pull-request revision
        if: github.event_name != 'merge_group'
        uses: ./changeplane
        with:
          token: \${{ github.token }}
          mode: \${{ steps.harness.outputs.mode }}
          trusted_controller_sha: \${{ steps.controller.outputs.sha }}
          agent_dispatch: none
      - name: Evaluate the merge queue without model or repair authority
        if: github.event_name == 'merge_group'
        uses: ./changeplane
        with:
          token: \${{ github.token }}
          mode: \${{ steps.harness.outputs.mode }}
          trusted_controller_sha: \${{ steps.controller.outputs.sha }}
          agent_dispatch: none
${reconciliationJob}`;
  const litePaths = new Set([
    "changeplane/action.yml",
    "changeplane/action/index.js",
    "changeplane/src/lib/changeplane.js",
    "changeplane/src/lib/harness.js",
    "changeplane/examples/changeplane-evidence-policy.js",
    "changeplane/package.json",
    ".github/workflows/changeplane.yml",
  ]);
  return managedFiles
    .filter(({ path: filePath }) => litePaths.has(filePath))
    .map((file) => file.path === ".github/workflows/changeplane.yml"
      ? { ...file, content: verifyLiteWorkflow }
      : file);
}

export function buildSetupFiles(requiredCheck = null, harnessMode = HARNESS_MODE.OBSERVE) {
  const harness = harnessPolicy({ mode: harnessMode });
  const managedProfile = managedProfileForHarness(harness.mode);
  const managedFiles = buildManagedFiles(managedProfile);
  if ([HARNESS_MODE.VERIFY, HARNESS_MODE.AUTONOMOUS].includes(harness.mode) && !requiredCheck) {
    throw new HttpError(400, `${harness.mode === HARNESS_MODE.VERIFY ? "Verify only" : "Autonomous mode"} requires one exact behavioral check and publisher.`);
  }
  const policy = {
    version: 1,
    protectedPaths: {
      requireApproval: [".github/**", "changeplane/**", "infra/**", "migrations/**"],
      block: [".env", ".env.local"],
    },
    evidence: {
      requiredChecks: requiredCheck ? [validateRequiredCheck(requiredCheck, {
        requireWorkflowPath: harness.mode !== HARNESS_MODE.OBSERVE,
      })] : [],
      protectedPaths: [...DEFAULT_EVIDENCE_PROTECTED_PATHS],
      timeoutSeconds: requiredCheck ? 120 : 0,
    },
    review: managedProfile === MANAGED_PROFILE.FULL
      ? {
        mode: "advisory",
        maxFindings: 5,
        memoryPath: ASSURANCE_MEMORY_PATH,
      }
      : {
        mode: "off",
        maxFindings: 0,
      },
    harness,
    runtime: {
      funding: "byok",
      provider: RUNTIME_PROVIDER,
      secretName: BYOK_SECRET_NAME,
      model: DEFAULT_PROPOSAL_MODEL,
      reasoningEffort: PROPOSAL_REASONING_EFFORT,
      managedSubscription: "reserved",
    },
  };

  const workflow = managedFiles.find(({ path: filePath }) => filePath === ".github/workflows/changeplane.yml");
  return [
    ...managedFiles.filter(({ path: filePath }) => filePath !== ".github/workflows/changeplane.yml"),
    { path: MANAGED_MANIFEST_PATH, content: managedManifestContent(managedFiles, managedProfile) },
    { path: POLICY_PATH, content: `${JSON.stringify(policy, null, 2)}\n` },
    ...(managedProfile === MANAGED_PROFILE.FULL
      ? [{ path: ASSURANCE_MEMORY_PATH, content: ASSURANCE_MEMORY_TEMPLATE }]
      : []),
    workflow,
  ];
}

export function buildRuntimePolicy(value, model, harnessMode) {
  const selectedModel = validateRuntimeModel(model);
  let policy;
  try {
    policy = JSON.parse(value);
  } catch {
    throw new HttpError(409, `${POLICY_PATH} is not valid JSON. Nothing was changed.`);
  }
  if (!policy || typeof policy !== "object" || Array.isArray(policy) || policy.version !== 1) {
    throw new HttpError(409, `${POLICY_PATH} is not a supported ChangePlane policy. Nothing was changed.`);
  }
  const selectedHarness = harnessPolicy({
    mode: harnessMode ?? policy?.harness?.mode,
    maxAttempts: policy?.harness?.maxAttempts,
    budgetMinutes: policy?.harness?.budgetMinutes,
  });
  const requiredChecks = policy?.evidence?.requiredChecks;
  if ([HARNESS_MODE.VERIFY, HARNESS_MODE.AUTONOMOUS].includes(selectedHarness.mode)
    && (!Array.isArray(requiredChecks) || requiredChecks.length === 0)) {
    throw new HttpError(409, `${selectedHarness.mode === HARNESS_MODE.VERIFY ? "Verify only" : "Autonomous repair"} requires at least one exact behavioral check and publisher.`);
  }
  try {
    validateRequiredChecks(requiredChecks, {
      mode: selectedHarness.mode === HARNESS_MODE.OBSERVE ? "observe" : "enforce",
    });
  } catch (error) {
    throw new HttpError(409, error instanceof Error ? error.message : "Repository evidence checks are malformed.");
  }
  return `${JSON.stringify({
    ...policy,
    harness: selectedHarness,
    runtime: {
      funding: "byok",
      provider: RUNTIME_PROVIDER,
      secretName: BYOK_SECRET_NAME,
      model: selectedModel,
      reasoningEffort: PROPOSAL_REASONING_EFFORT,
      managedSubscription: "reserved",
    },
  }, null, 2)}\n`;
}

function parsedManagedManifest(value) {
  if (typeof value !== "string") return null;
  try {
    const manifest = JSON.parse(value);
    const managedProfile = manifest?.schemaVersion === 1
      ? MANAGED_PROFILE.FULL
      : manifest?.schemaVersion === 2 && Object.values(MANAGED_PROFILE).includes(manifest.managedProfile)
        ? manifest.managedProfile
        : null;
    return managedProfile
      && Number.isSafeInteger(manifest.managedVersion)
      && manifest.managedVersion > 0
      && manifest.managedFiles
      && typeof manifest.managedFiles === "object"
      && !Array.isArray(manifest.managedFiles)
      ? { ...manifest, managedProfile }
      : null;
  } catch {
    return null;
  }
}

export function managedVersionSnapshot(managedVersion, managedProfile = MANAGED_PROFILE.FULL) {
  const profile = managedVersion >= 13
    ? validateManagedProfile(managedProfile)
    : MANAGED_PROFILE.FULL;
  const desiredManagedFiles = buildManagedFiles(profile);
  const desiredHashes = Object.fromEntries(desiredManagedFiles.map(({ path: filePath, content }) => (
    [filePath, contentDigest(content)]
  )));
  const managedHashes = managedVersion === MANAGED_VERSION
    ? desiredHashes
    : managedVersion >= 13
      ? KNOWN_MANAGED_VERSION_HASHES[managedVersion]?.[profile]
      : KNOWN_MANAGED_VERSION_HASHES[managedVersion];
  return managedHashes
    ? {
      managedVersion,
      managedProfile: profile,
      manifest: managedManifestFromHashes(managedVersion, managedHashes, profile),
      managedHashes: { ...managedHashes },
    }
    : null;
}

export function classifyManagedInstallationDigests({
  digests,
  manifest,
  policyPresent,
  reservedEntries = [],
}) {
  if (!digests || typeof digests !== "object" || Array.isArray(digests)
    || typeof policyPresent !== "boolean" || !Array.isArray(reservedEntries)) {
    throw new TypeError("Managed installation digest inspection is invalid.");
  }
  const parsedManifest = parsedManagedManifest(manifest);
  const manifestProfile = parsedManifest?.managedProfile ?? MANAGED_PROFILE.FULL;
  const desiredHashes = managedVersionSnapshot(MANAGED_VERSION, manifestProfile).managedHashes;
  const allowedManagedPaths = parsedManifest
    ? Object.keys(managedVersionSnapshot(parsedManifest.managedVersion, manifestProfile)?.managedHashes ?? {})
    : MANAGED_PATHS;
  const allowedReservedFiles = new Set([
    ...allowedManagedPaths,
    MANAGED_MANIFEST_PATH,
    POLICY_PATH,
    ...(manifestProfile === MANAGED_PROFILE.FULL ? [ASSURANCE_MEMORY_PATH] : []),
  ]);
  const conflicts = reservedEntries
    .filter((entry) => isManagedReservedFile(entry) && !allowedReservedFiles.has(entry));

  if (!policyPresent) conflicts.push(POLICY_PATH);

  if (manifest == null) {
    const matchesCatalog = (catalog, { allowMissingOutsideCatalog = false } = {}) => (
      Object.entries(catalog).every(([filePath, digest]) => (
        digests[filePath] === digest
      ))
      && (allowMissingOutsideCatalog || MANAGED_PATHS.every((filePath) => (
        Object.hasOwn(catalog, filePath) || digests[filePath] == null
      )))
    );
    const matchesLegacy = matchesCatalog(LEGACY_MANAGED_HASHES);
    const matchesCurrentWithoutManifest = matchesCatalog(desiredHashes, { allowMissingOutsideCatalog: true });
    if (!matchesLegacy && !matchesCurrentWithoutManifest) {
      for (const filePath of MANAGED_PATHS) {
        const digest = digests[filePath];
        if (digest == null) continue;
        if (digest !== LEGACY_MANAGED_HASHES[filePath] && digest !== desiredHashes[filePath]) conflicts.push(filePath);
      }
      if (conflicts.length === 0) conflicts.push(MANAGED_MANIFEST_PATH);
    }
    const uniqueConflicts = [...new Set(conflicts)].sort();
    return uniqueConflicts.length === 0
      ? { state: "outdated", currentVersion: 0, targetVersion: MANAGED_VERSION, conflicts: [] }
      : { state: "conflict", currentVersion: null, targetVersion: MANAGED_VERSION, conflicts: uniqueConflicts };
  }

  const snapshot = managedVersionSnapshot(parsedManifest?.managedVersion, manifestProfile);
  const catalogHashes = snapshot?.managedHashes;
  const expectedManifest = snapshot?.manifest ?? null;
  if (!parsedManifest || parsedManifest.managedVersion > MANAGED_VERSION || manifest !== expectedManifest) {
    conflicts.push(MANAGED_MANIFEST_PATH);
  }
  for (const filePath of Object.keys(catalogHashes ?? {})) {
    if (digests[filePath] !== catalogHashes[filePath]) {
      conflicts.push(filePath);
    }
  }
  const uniqueConflicts = [...new Set(conflicts)].sort();
  if (uniqueConflicts.length > 0) {
    return { state: "conflict", currentVersion: null, targetVersion: MANAGED_VERSION, conflicts: uniqueConflicts };
  }
  return parsedManifest.managedVersion === MANAGED_VERSION
    ? {
      state: "current",
      currentVersion: MANAGED_VERSION,
      targetVersion: MANAGED_VERSION,
      managedProfile: manifestProfile,
      conflicts: [],
    }
    : {
      state: "outdated",
      currentVersion: parsedManifest.managedVersion,
      targetVersion: MANAGED_VERSION,
      managedProfile: manifestProfile,
      conflicts: [],
    };
}

export function classifyManagedInstallation({ files, reservedEntries = [] }) {
  if (!files || typeof files !== "object" || Array.isArray(files) || !Array.isArray(reservedEntries)) {
    throw new TypeError("Managed installation inspection is invalid.");
  }
  return classifyManagedInstallationDigests({
    digests: Object.fromEntries(Object.entries(files)
      .filter(([, content]) => typeof content === "string")
      .map(([filePath, content]) => [filePath, contentDigest(content)])),
    manifest: files[MANAGED_MANIFEST_PATH],
    policyPresent: typeof files[POLICY_PATH] === "string",
    reservedEntries,
  });
}

export function classifyManagedRuntimeTree({ manifest, policy, treeEntries }) {
  if (!Array.isArray(treeEntries)) {
    throw new TypeError("Managed runtime tree inspection requires Git tree entries.");
  }
  const parsedManifest = parsedManagedManifest(manifest);
  const managedProfile = parsedManifest?.managedProfile ?? MANAGED_PROFILE.FULL;
  const managedFiles = buildManagedFiles(managedProfile);
  const expectedManifest = managedManifestContent(managedFiles, managedProfile);
  const expectedFiles = new Map([
    ...managedFiles.map(({ path: filePath, content }) => [filePath, content]),
    [MANAGED_MANIFEST_PATH, expectedManifest],
    ...(typeof policy === "string" ? [[POLICY_PATH, policy]] : []),
  ]);
  const allowedReservedFiles = new Set([
    ...expectedFiles.keys(),
    ...(managedProfile === MANAGED_PROFILE.FULL ? [ASSURANCE_MEMORY_PATH] : []),
  ]);
  const conflicts = [];
  const entries = new Map();
  for (const entry of treeEntries) {
    if (!entry || entry.type === "tree" || typeof entry.path !== "string") continue;
    if (entries.has(entry.path)) conflicts.push(entry.path);
    entries.set(entry.path, entry);
    if (isManagedReservedFile(entry.path) && !allowedReservedFiles.has(entry.path)) {
      conflicts.push(entry.path);
    }
  }

  if (parsedManifest?.managedVersion !== MANAGED_VERSION || manifest !== expectedManifest) {
    conflicts.push(MANAGED_MANIFEST_PATH);
  }
  if (typeof policy !== "string") conflicts.push(POLICY_PATH);
  for (const [filePath, content] of expectedFiles) {
    const entry = entries.get(filePath);
    if (entry?.type !== "blob" || entry.mode !== "100644" || entry.sha !== gitBlobDigest(content)) {
      conflicts.push(filePath);
    }
  }
  const assuranceEntry = entries.get(ASSURANCE_MEMORY_PATH);
  if (managedProfile === MANAGED_PROFILE.FULL && assuranceEntry
    && (assuranceEntry.type !== "blob" || assuranceEntry.mode !== "100644")) {
    conflicts.push(ASSURANCE_MEMORY_PATH);
  }

  const uniqueConflicts = [...new Set(conflicts)].sort();
  return uniqueConflicts.length > 0
    ? {
      state: "conflict",
      managedProfile: null,
      conflicts: uniqueConflicts,
    }
    : {
      state: "current",
      managedProfile,
      conflicts: [],
    };
}

async function readRepositoryFile(encodedRepository, filePath, ref, token) {
  try {
    const payload = await github(
      `/repos/${encodedRepository}/contents/${encodePath(filePath)}?ref=${encodeURIComponent(ref)}`,
      token,
    );
    if (payload?.type !== "file" || payload.encoding !== "base64" || typeof payload.content !== "string") return false;
    return Buffer.from(payload.content.replaceAll("\n", ""), "base64").toString("utf8");
  } catch (error) {
    if (error instanceof GitHubError && error.status === 404) return null;
    throw error;
  }
}

async function inspectManagedInstallation(encodedRepository, baseSha, token) {
  const inspectedPaths = [...MANAGED_PATHS, MANAGED_MANIFEST_PATH, POLICY_PATH];
  const contents = await Promise.all(inspectedPaths.map((filePath) => (
    readRepositoryFile(encodedRepository, filePath, baseSha, token)
  )));
  const files = Object.fromEntries(inspectedPaths.map((filePath, index) => [filePath, contents[index]]));
  const commit = await github(`/repos/${encodedRepository}/git/commits/${baseSha}`, token);
  const treeSha = commit?.tree?.sha;
  if (!/^[a-f0-9]{40}$/u.test(treeSha ?? "")) throw new Error("GitHub returned an invalid default-branch tree.");
  const tree = await github(`/repos/${encodedRepository}/git/trees/${treeSha}?recursive=1`, token);
  const reservedEntries = tree?.truncated || !Array.isArray(tree?.tree)
    ? ["changeplane/**"]
    : tree.tree
      .filter((entry) => entry?.type !== "tree" && typeof entry?.path === "string")
      .map((entry) => entry.path);
  const installation = classifyManagedInstallation({ files, reservedEntries });
  const policyMigration = installation.state === "outdated"
    ? classifyUpgradePolicyMigration(files[POLICY_PATH])
    : null;
  return policyMigration ? { ...installation, policyMigration } : installation;
}

function encodeRepository(repository) {
  return repository.split("/").map(encodeURIComponent).join("/");
}

function encodePath(filePath) {
  return filePath.split("/").map(encodeURIComponent).join("/");
}

function encodeRef(ref) {
  return ref.split("/").map(encodeURIComponent).join("/");
}

function observeSetupResult(repo, pullRequest, {
  branch = OBSERVE_SETUP_BRANCH,
  operation = "install",
  harnessMode = HARNESS_MODE.OBSERVE,
  managedProfile = managedProfileForHarness(harnessMode),
  policyIncluded = operation !== "upgrade",
  policyMigration = null,
} = {}) {
  if (!Number.isSafeInteger(pullRequest?.number) || typeof pullRequest?.html_url !== "string") {
    throw new Error("GitHub returned an invalid setup pull request.");
  }
  return {
    repository: repo.full_name,
    branch,
    operation,
    harnessMode,
    managedVersion: MANAGED_VERSION,
    managedProfile: validateManagedProfile(managedProfile),
    policyIncluded,
    ...(policyMigration ? { policyMigration } : {}),
    pullRequest: {
      number: pullRequest.number,
      url: pullRequest.html_url,
      state: pullRequest.state,
    },
  };
}

function observeSetupPlan(files, requiredCheck = null, harnessMode = HARNESS_MODE.OBSERVE) {
  const scope = files.map(({ path: filePath }) => filePath === "changeplane/package.json" ? "changeplane/**" : filePath);
  const mode = harnessPolicy({ mode: harnessMode }).mode;
  const plan = {
    goal: `Install the ChangePlane ${mode} harness`,
    scope: [...new Set(scope)],
    harnessMode: mode,
    managedVersion: MANAGED_VERSION,
    managedProfile: managedProfileForHarness(mode),
  };
  if (requiredCheck) plan.requiredCheck = validateRequiredCheck(requiredCheck);
  return plan;
}

function readObserveSetupPlan(body) {
  const match = String(body ?? "").match(/^<!-- changeplane ([^\n]+) -->/u);
  if (!match) return null;
  try {
    const plan = JSON.parse(match[1]);
    const requiredCheck = validateRequiredCheck(plan?.requiredCheck);
    const harnessMode = harnessPolicy({ mode: plan?.harnessMode }).mode;
    if (![HARNESS_MODE.OBSERVE, HARNESS_MODE.VERIFY].includes(harnessMode)) return null;
    if ((harnessMode === HARNESS_MODE.VERIFY && !requiredCheck)
      || (harnessMode === HARNESS_MODE.OBSERVE && requiredCheck != null)) return null;
    const expectedFiles = buildSetupFiles(requiredCheck, harnessMode);
    const expected = observeSetupPlan(expectedFiles, requiredCheck, harnessMode);
    return JSON.stringify(plan) === JSON.stringify(expected) ? { plan, requiredCheck, harnessMode } : null;
  } catch {
    return null;
  }
}

function observeUpgradePlan(files, recovery = null) {
  return {
    goal: `Upgrade ChangePlane managed files to version ${MANAGED_VERSION}`,
    scope: files.map(({ path: filePath }) => filePath),
    managedVersion: MANAGED_VERSION,
    ...(recovery ? {
      policyRecovery: {
        harnessMode: recovery.harnessMode,
        requiredCheck: recovery.requiredCheck,
      },
    } : {}),
  };
}

function readObserveUpgradePlan(body) {
  const match = String(body ?? "").match(/^<!-- changeplane ([^\n]+) -->/u);
  if (!match) return null;
  try {
    const plan = JSON.parse(match[1]);
    if (!plan || typeof plan !== "object" || Array.isArray(plan)
      || plan.goal !== `Upgrade ChangePlane managed files to version ${MANAGED_VERSION}`
      || plan.managedVersion !== MANAGED_VERSION
      || !Array.isArray(plan.scope)
      || plan.scope.length === 0
      || plan.scope.some((filePath) => typeof filePath !== "string" || !filePath)
      || new Set(plan.scope).size !== plan.scope.length
      || Object.keys(plan).some((key) => !["goal", "scope", "managedVersion", "policyRecovery"].includes(key))) {
      return null;
    }
    if (Object.hasOwn(plan, "policyRecovery")) {
      const recovery = plan.policyRecovery;
      if (!recovery || typeof recovery !== "object" || Array.isArray(recovery)
        || Object.keys(recovery).some((key) => !["harnessMode", "requiredCheck"].includes(key))) {
        return null;
      }
      const mode = harnessPolicy({ mode: recovery.harnessMode }).mode;
      if (![HARNESS_MODE.VERIFY, HARNESS_MODE.OBSERVE].includes(mode)) return null;
      const requiredCheck = validateRequiredCheck(recovery.requiredCheck, {
        requireWorkflowPath: mode === HARNESS_MODE.VERIFY,
      });
      if ((mode === HARNESS_MODE.VERIFY && !requiredCheck)
        || (mode === HARNESS_MODE.OBSERVE && requiredCheck != null)) {
        return null;
      }
      const expectedRecovery = { harnessMode: mode, requiredCheck };
      if (JSON.stringify(recovery) !== JSON.stringify(expectedRecovery)) return null;
    }
    return plan;
  } catch {
    return null;
  }
}

async function findObserveSetupPullRequest(encodedRepository, repo, token, files, expectedPlan = null) {
  const owner = repo.full_name.split("/")[0];
  const pulls = await github(
    `/repos/${encodedRepository}/pulls?state=open&base=${encodeURIComponent(repo.default_branch)}&head=${encodeURIComponent(`${owner}:${OBSERVE_SETUP_BRANCH}`)}&per_page=10`,
    token,
  );
  if (!Array.isArray(pulls)) throw new Error("GitHub returned an invalid setup pull-request list.");
  const matches = pulls.filter((pullRequest) => {
    const parsed = readObserveSetupPlan(pullRequest?.body);
    return pullRequest?.state === "open"
      && pullRequest.head?.ref === OBSERVE_SETUP_BRANCH
      && pullRequest.head?.repo?.full_name?.toLowerCase() === repo.full_name.toLowerCase()
      && pullRequest.base?.ref === repo.default_branch
      && pullRequest.title === "chore: install ChangePlane harness"
      && parsed
      && (!expectedPlan || JSON.stringify(parsed.plan) === JSON.stringify(expectedPlan));
  });
  if (matches.length > 1) throw new HttpError(409, "Multiple ChangePlane setup pull requests already exist.");
  return matches[0] ?? null;
}

async function findObserveUpgradePullRequest(encodedRepository, repo, token, expectedPlan = null) {
  const owner = repo.full_name.split("/")[0];
  const pulls = await github(
    `/repos/${encodedRepository}/pulls?state=open&base=${encodeURIComponent(repo.default_branch)}&head=${encodeURIComponent(`${owner}:${OBSERVE_UPGRADE_BRANCH}`)}&per_page=10`,
    token,
  );
  if (!Array.isArray(pulls)) throw new Error("GitHub returned an invalid upgrade pull-request list.");
  const matches = pulls.filter((pullRequest) => {
    const plan = readObserveUpgradePlan(pullRequest?.body);
    return pullRequest?.state === "open"
      && pullRequest.head?.ref === OBSERVE_UPGRADE_BRANCH
      && pullRequest.head?.repo?.full_name?.toLowerCase() === repo.full_name.toLowerCase()
      && pullRequest.base?.ref === repo.default_branch
      && pullRequest.title === "chore: upgrade ChangePlane managed setup"
      && plan
      && (!expectedPlan || JSON.stringify(plan) === JSON.stringify(expectedPlan));
  });
  if (matches.length > 1) throw new HttpError(409, "Multiple ChangePlane upgrade pull requests already exist.");
  return matches[0] ?? null;
}

async function readBranchHead(encodedRepository, branch, token) {
  try {
    const ref = await github(`/repos/${encodedRepository}/git/ref/heads/${encodeRef(branch)}`, token);
    return /^[a-f0-9]{40}$/u.test(ref?.object?.sha ?? "") ? ref.object.sha : null;
  } catch (error) {
    if (error instanceof GitHubError && error.status === 404) return null;
    throw error;
  }
}

async function readObserveSetupHead(encodedRepository, token) {
  return readBranchHead(encodedRepository, OBSERVE_SETUP_BRANCH, token);
}

async function assertObserveSetupHead(encodedRepository, headSha, baseSha, expectedTreeSha, token) {
  if (!/^[a-f0-9]{40}$/u.test(headSha ?? "")) throw new Error("GitHub returned an invalid setup branch revision.");
  const commit = await github(`/repos/${encodedRepository}/git/commits/${headSha}`, token);
  if (commit?.tree?.sha !== expectedTreeSha || commit?.parents?.length !== 1 || commit.parents[0]?.sha !== baseSha) {
    throw new HttpError(409, `Branch ${OBSERVE_SETUP_BRANCH} already exists with different content.`);
  }
}

async function validateObserveSetupPullRequest(encodedRepository, pullRequest, baseSha, files, token) {
  const headSha = pullRequest?.head?.sha;
  if (!/^[a-f0-9]{40}$/u.test(headSha ?? "") || pullRequest?.base?.sha !== baseSha) {
    throw new HttpError(409, "The existing ChangePlane setup pull request has an invalid revision.");
  }
  const branchHead = await readObserveSetupHead(encodedRepository, token);
  if (branchHead !== headSha) {
    throw new HttpError(409, "The existing ChangePlane setup pull request is not bound to the setup branch head.");
  }
  const commit = await github(`/repos/${encodedRepository}/git/commits/${headSha}`, token);
  const treeSha = commit?.tree?.sha;
  if (!/^[a-f0-9]{40}$/u.test(treeSha ?? "") || commit?.parents?.length !== 1 || commit.parents[0]?.sha !== baseSha) {
    throw new HttpError(409, "The existing ChangePlane setup pull request is not based on the current default branch.");
  }
  const comparison = await github(`/repos/${encodedRepository}/compare/${baseSha}...${headSha}`, token);
  const expectedPaths = files.map(({ path: filePath }) => filePath).sort();
  const actualPaths = Array.isArray(comparison?.files)
    ? comparison.files.map(({ filename }) => filename).sort()
    : [];
  if (
    comparison?.base_commit?.sha !== baseSha
    || comparison?.merge_base_commit?.sha !== baseSha
    || comparison?.ahead_by !== 1
    || comparison?.behind_by !== 0
    || comparison?.total_commits !== 1
    || actualPaths.length !== expectedPaths.length
    || actualPaths.some((filePath, index) => filePath !== expectedPaths[index])
    || comparison.files.some((file) => file?.status !== "added" || file?.previous_filename != null)
  ) {
    throw new HttpError(409, "The existing ChangePlane setup pull request contains unexpected files.");
  }
  const tree = await github(`/repos/${encodedRepository}/git/trees/${treeSha}?recursive=1`, token);
  if (tree?.truncated || !Array.isArray(tree?.tree)) {
    throw new HttpError(409, "The existing ChangePlane setup pull request has an unverifiable tree.");
  }
  const entries = new Map(tree.tree.map((entry) => [entry?.path, entry]));
  await Promise.all(files.map(async ({ path: filePath, content }) => {
    const blobSha = gitBlobDigest(content);
    const entry = entries.get(filePath);
    if (entry?.mode !== "100644" || entry?.type !== "blob" || entry?.sha !== blobSha) {
      throw new HttpError(409, `The existing setup tree is invalid: ${filePath}.`);
    }
    const remote = await github(`/repos/${encodedRepository}/contents/${encodePath(filePath)}?ref=${headSha}`, token);
    if (remote?.type !== "file" || remote?.encoding !== "base64" || typeof remote?.content !== "string") {
      throw new HttpError(409, `The existing setup file is invalid: ${filePath}.`);
    }
    const decoded = Buffer.from(remote.content.replaceAll("\n", ""), "base64").toString("utf8");
    if (decoded !== content) throw new HttpError(409, `The existing setup file was modified: ${filePath}.`);
    if (remote.sha !== blobSha) throw new HttpError(409, `The existing setup file identity is invalid: ${filePath}.`);
  }));
}

async function validateObserveUpgradePullRequest(
  encodedRepository,
  pullRequest,
  baseSha,
  files,
  expectedStatuses,
  expectedPlan,
  token,
) {
  const policyIncluded = files.some(({ path: filePath }) => filePath === POLICY_PATH);
  if (policyIncluded !== Boolean(expectedPlan?.policyRecovery)
    || JSON.stringify(readObserveUpgradePlan(pullRequest?.body)) !== JSON.stringify(expectedPlan)) {
    throw new HttpError(409, "The existing ChangePlane upgrade pull request has an invalid recovery plan.");
  }
  const headSha = pullRequest?.head?.sha;
  if (!/^[a-f0-9]{40}$/u.test(headSha ?? "") || pullRequest?.base?.sha !== baseSha) {
    throw new HttpError(409, "The existing ChangePlane upgrade pull request has an invalid revision.");
  }
  const branchHead = await readBranchHead(encodedRepository, OBSERVE_UPGRADE_BRANCH, token);
  if (branchHead !== headSha) {
    throw new HttpError(409, "The existing ChangePlane upgrade pull request is not bound to the upgrade branch head.");
  }
  const commit = await github(`/repos/${encodedRepository}/git/commits/${headSha}`, token);
  const treeSha = commit?.tree?.sha;
  if (!/^[a-f0-9]{40}$/u.test(treeSha ?? "") || commit?.parents?.length !== 1 || commit.parents[0]?.sha !== baseSha) {
    throw new HttpError(409, "The existing ChangePlane upgrade pull request is not based on the current default branch.");
  }
  const comparison = await github(`/repos/${encodedRepository}/compare/${baseSha}...${headSha}`, token);
  const expectedPaths = files.map(({ path: filePath }) => filePath).sort();
  const actualFiles = Array.isArray(comparison?.files) ? comparison.files : [];
  const actualPaths = actualFiles.map(({ filename }) => filename).sort();
  if (
    comparison?.base_commit?.sha !== baseSha
    || comparison?.merge_base_commit?.sha !== baseSha
    || comparison?.ahead_by !== 1
    || comparison?.behind_by !== 0
    || comparison?.total_commits !== 1
    || actualPaths.length !== expectedPaths.length
    || actualPaths.some((filePath, index) => filePath !== expectedPaths[index])
    || actualFiles.some((file) => file?.status !== expectedStatuses.get(file.filename) || file?.previous_filename != null)
  ) {
    throw new HttpError(409, "The existing ChangePlane upgrade pull request contains unexpected files.");
  }
  const tree = await github(`/repos/${encodedRepository}/git/trees/${treeSha}?recursive=1`, token);
  if (tree?.truncated || !Array.isArray(tree?.tree)) {
    throw new HttpError(409, "The existing ChangePlane upgrade pull request has an unverifiable tree.");
  }
  const entries = new Map(tree.tree.map((entry) => [entry?.path, entry]));
  await Promise.all(files.map(async ({ path: filePath, content }) => {
    const blobSha = gitBlobDigest(content);
    const entry = entries.get(filePath);
    if (entry?.mode !== "100644" || entry?.type !== "blob" || entry?.sha !== blobSha) {
      throw new HttpError(409, `The existing upgrade tree is invalid: ${filePath}.`);
    }
    const remote = await github(`/repos/${encodedRepository}/contents/${encodePath(filePath)}?ref=${headSha}`, token);
    if (remote?.type !== "file" || remote?.encoding !== "base64" || typeof remote?.content !== "string") {
      throw new HttpError(409, `The existing upgrade file is invalid: ${filePath}.`);
    }
    const decoded = Buffer.from(remote.content.replaceAll("\n", ""), "base64").toString("utf8");
    if (decoded !== content || remote.sha !== blobSha) {
      throw new HttpError(409, `The existing upgrade file was modified: ${filePath}.`);
    }
  }));
}

async function managedUpgradeFiles(encodedRepository, baseSha, token, policyContent = null) {
  const currentManifest = await readRepositoryFile(encodedRepository, MANAGED_MANIFEST_PATH, baseSha, token);
  const parsedManifest = parsedManagedManifest(currentManifest);
  if (currentManifest != null && !parsedManifest) {
    throw new HttpError(409, "The installed managed profile is invalid. No upgrade was created.");
  }
  const managedProfile = parsedManifest?.managedProfile ?? MANAGED_PROFILE.FULL;
  const managedFiles = buildManagedFiles(managedProfile);
  const desired = [
    ...managedFiles,
    {
      path: MANAGED_MANIFEST_PATH,
      content: managedManifestContent(managedFiles, managedProfile),
    },
    ...(typeof policyContent === "string" ? [{ path: POLICY_PATH, content: policyContent }] : []),
  ];
  const current = await Promise.all(desired.map(({ path: filePath }) => (
    readRepositoryFile(encodedRepository, filePath, baseSha, token)
  )));
  const files = [];
  const expectedStatuses = new Map();
  desired.forEach((file, index) => {
    if (current[index] === file.content) return;
    files.push(file);
    expectedStatuses.set(file.path, current[index] == null ? "added" : "modified");
  });
  return { files, expectedStatuses, managedProfile };
}

export async function createObserveUpgradePullRequest(target, session, requiredCheck = null, harnessMode = undefined) {
  const { encodedRepository, repo, baseSha } = target;
  const token = session.token;
  const currentPolicy = await readRepositoryFile(encodedRepository, POLICY_PATH, baseSha, token);
  const migration = classifyUpgradePolicyMigration(currentPolicy);
  if (migration && repo.permissions?.admin !== true) {
    throw new HttpError(403, "A repository administrator must choose the exact v13 evidence Check and review the recovery pull request.");
  }
  let recovery = null;
  if (migration) {
    const policyContent = buildUpgradeRecoveryPolicy(currentPolicy, requiredCheck, harnessMode);
    const policy = JSON.parse(policyContent);
    recovery = {
      policyContent,
      harnessMode: policy.harness.mode,
      requiredCheck: policy.evidence.requiredChecks[0] ?? null,
    };
  }
  const { files, expectedStatuses, managedProfile } = await managedUpgradeFiles(
    encodedRepository,
    baseSha,
    token,
    recovery?.policyContent,
  );
  if (files.length === 0) {
    throw new HttpError(409, "ChangePlane managed files are already current or cannot be upgraded safely.");
  }
  const plan = observeUpgradePlan(files, recovery);
  const resultOptions = {
    branch: OBSERVE_UPGRADE_BRANCH,
    operation: "upgrade",
    harnessMode: recovery?.harnessMode ?? HARNESS_MODE.OBSERVE,
    managedProfile,
    policyIncluded: Boolean(recovery),
    policyMigration: recovery ? {
      ...migration,
      appliedHarnessMode: recovery.harnessMode,
      requiredCheck: recovery.requiredCheck,
    } : null,
  };
  const existingPullRequest = await findObserveUpgradePullRequest(encodedRepository, repo, token);
  if (existingPullRequest) {
    const existingPlan = readObserveUpgradePlan(existingPullRequest.body);
    if (JSON.stringify(existingPlan) !== JSON.stringify(plan)) {
      throw new HttpError(409, `The existing upgrade PR does not match the required v13 recovery. Close it and delete ${OBSERVE_UPGRADE_BRANCH}, then retry.`);
    }
    await validateObserveUpgradePullRequest(
      encodedRepository,
      existingPullRequest,
      baseSha,
      files,
      expectedStatuses,
      plan,
      token,
    );
    return observeSetupResult(repo, existingPullRequest, resultOptions);
  }

  if (await readBranchHead(encodedRepository, OBSERVE_UPGRADE_BRANCH, token)) {
    throw new HttpError(409, `Branch ${OBSERVE_UPGRADE_BRANCH} already exists without the required verified recovery PR. Delete the branch, then retry.`);
  }

  const currentBaseRef = await github(
    `/repos/${encodedRepository}/git/ref/heads/${encodeRef(repo.default_branch)}`,
    token,
  );
  if (currentBaseRef?.object?.sha !== baseSha) {
    throw new HttpError(409, "The default branch changed during upgrade preflight. Retry before creating an upgrade pull request.");
  }

  const baseCommit = await github(`/repos/${encodedRepository}/git/commits/${baseSha}`, token);
  const baseTree = baseCommit?.tree?.sha;
  if (!/^[a-f0-9]{40}$/u.test(baseTree ?? "")) throw new Error("GitHub returned an invalid base tree.");
  const blobs = await Promise.all(files.map(({ content }) => github(`/repos/${encodedRepository}/git/blobs`, token, {
    method: "POST",
    body: { content, encoding: "utf-8" },
  })));
  const tree = await github(`/repos/${encodedRepository}/git/trees`, token, {
    method: "POST",
    body: {
      base_tree: baseTree,
      tree: files.map((file, index) => ({
        path: file.path,
        mode: "100644",
        type: "blob",
        sha: blobs[index].sha,
      })),
    },
  });
  if (!/^[a-f0-9]{40}$/u.test(tree?.sha ?? "")) throw new Error("GitHub returned an invalid upgrade tree.");

  let upgradeHead = await readBranchHead(encodedRepository, OBSERVE_UPGRADE_BRANCH, token);
  if (!upgradeHead) {
    const commit = await github(`/repos/${encodedRepository}/git/commits`, token, {
      method: "POST",
      body: {
        message: `chore: upgrade ChangePlane managed setup to v${MANAGED_VERSION}`,
        tree: tree.sha,
        parents: [baseSha],
      },
    });
    if (!/^[a-f0-9]{40}$/u.test(commit?.sha ?? "")) throw new Error("GitHub returned an invalid upgrade commit.");
    try {
      await github(`/repos/${encodedRepository}/git/refs`, token, {
        method: "POST",
        body: { ref: `refs/heads/${OBSERVE_UPGRADE_BRANCH}`, sha: commit.sha },
      });
    } catch (error) {
      if (!(error instanceof GitHubError) || error.status !== 422) throw error;
    }
    upgradeHead = await readBranchHead(encodedRepository, OBSERVE_UPGRADE_BRANCH, token);
  }
  if (!/^[a-f0-9]{40}$/u.test(upgradeHead ?? "")) throw new Error("GitHub returned an invalid upgrade branch revision.");
  const upgradeCommit = await github(`/repos/${encodedRepository}/git/commits/${upgradeHead}`, token);
  if (upgradeCommit?.tree?.sha !== tree.sha || upgradeCommit?.parents?.length !== 1 || upgradeCommit.parents[0]?.sha !== baseSha) {
    throw new HttpError(409, `Branch ${OBSERVE_UPGRADE_BRANCH} already exists with different content.`);
  }

  try {
    const pullRequest = await github(`/repos/${encodedRepository}/pulls`, token, {
      method: "POST",
      body: {
        title: "chore: upgrade ChangePlane managed setup",
        head: OBSERVE_UPGRADE_BRANCH,
        base: repo.default_branch,
        body: [
          `<!-- changeplane ${JSON.stringify(plan)} -->`,
          "## ChangePlane managed upgrade",
          "",
          recovery
            ? `This updates ${files.length - 1} pristine ChangePlane-managed file${files.length - 1 === 1 ? "" : "s"} to managed version ${MANAGED_VERSION} and includes one narrowly scoped recovery change to \`${POLICY_PATH}\`.`
            : `This updates only ${files.length} pristine ChangePlane-managed file${files.length === 1 ? "" : "s"} to managed version ${MANAGED_VERSION}.`,
          "",
          recovery
            ? recovery.harnessMode === HARNESS_MODE.VERIFY
              ? `The recovered policy binds \`${recovery.requiredCheck.name}\` from \`${recovery.requiredCheck.appSlug}\`${recovery.requiredCheck.workflowPath ? ` at \`${recovery.requiredCheck.workflowPath}\`` : ""} and resets the harness to Verify only. Autonomous repair is not retained and no repair credential is provisioned.`
              : "The recovered policy explicitly selects scope-only Observe, clears behavioral required Checks, and disables autonomous repair. No repair credential is provisioned."
            : `The repository-owned \`${POLICY_PATH}\` policy is not changed.`,
          "",
          recovery
            ? `Repository owner action after merge: replace any legacy \`github-actions\` branch-policy binding for \`${GUARD_CHECK_NAME}\` with the v13 dedicated ChangePlane App publisher in one strict, no-bypass default-branch Ruleset. \`${GUARD_EVALUATION_CHECK_NAME}\` remains operational workflow liveness, not a second assurance authority.`
            : "No branch-policy setting is changed by this pull request.",
          "",
          "No default-branch write occurs until a human reviews and merges this pull request.",
          "",
          "Closing this pull request stops the upgrade.",
        ].join("\n"),
      },
    });
    await validateObserveUpgradePullRequest(
      encodedRepository,
      pullRequest,
      baseSha,
      files,
      expectedStatuses,
      plan,
      token,
    );
    return observeSetupResult(repo, pullRequest, resultOptions);
  } catch (error) {
    if (error instanceof GitHubError && error.status === 422) {
      const pullRequest = await findObserveUpgradePullRequest(encodedRepository, repo, token, plan);
      if (pullRequest) {
        await validateObserveUpgradePullRequest(
          encodedRepository,
          pullRequest,
          baseSha,
          files,
          expectedStatuses,
          plan,
          token,
        );
        return observeSetupResult(repo, pullRequest, resultOptions);
      }
    }
    throw error;
  }
}

async function createObservePullRequest(repository, session, requiredCheck = null, harnessMode = undefined) {
  const token = session.token;
  const target = await inspectInstallTarget(repository, session);
  const { encodedRepository, repo, baseSha, conflicts, repositoryState, installation } = target;
  if (repositoryState !== "active") {
    throw new HttpError(409, `ChangePlane cannot install into a ${repositoryState} repository.`);
  }
  if (installation.state === "current") {
    throw new HttpError(409, `ChangePlane managed version ${MANAGED_VERSION} is already installed.`);
  }
  if (conflicts.length > 0) {
    throw new HttpError(409, `ChangePlane will not overwrite repository-owned or modified paths: ${conflicts.join(", ")}`);
  }
  if (installation.state === "outdated") {
    return createObserveUpgradePullRequest(target, session, requiredCheck, harnessMode);
  }
  const selectedHarness = harnessPolicy({ mode: harnessMode });
  const baseFiles = buildSetupFiles();
  const existingPullRequest = await findObserveSetupPullRequest(encodedRepository, repo, token, baseFiles);
  if (existingPullRequest) {
    const existingPlan = readObserveSetupPlan(existingPullRequest.body, baseFiles);
    const existingFiles = buildSetupFiles(existingPlan.requiredCheck, existingPlan.harnessMode);
    await validateObserveSetupPullRequest(encodedRepository, existingPullRequest, baseSha, existingFiles, token);
    if (JSON.stringify(existingPlan.requiredCheck) !== JSON.stringify(requiredCheck)
      || existingPlan.harnessMode !== selectedHarness.mode) {
      throw new HttpError(409, "The existing verified setup PR binds a different evidence or harness choice. Open that PR, or close it and delete changeplane/observe-setup before creating a replacement.");
    }
    return observeSetupResult(repo, existingPullRequest, { harnessMode: selectedHarness.mode });
  }

  if (await readObserveSetupHead(encodedRepository, token)) {
    throw new HttpError(409, `Branch ${OBSERVE_SETUP_BRANCH} already exists without a compatible verified Verify-first setup PR. Delete the branch, then retry.`);
  }

  const files = buildSetupFiles(requiredCheck, selectedHarness.mode);
  const behaviorEvidence = requiredCheck
    ? `\`${requiredCheck.name}\` from \`${requiredCheck.appSlug}\``
    : null;
  const plan = observeSetupPlan(files, requiredCheck, selectedHarness.mode);

  const baseCommit = await github(`/repos/${encodedRepository}/git/commits/${baseSha}`, token);
  const baseTree = baseCommit?.tree?.sha;
  if (!/^[a-f0-9]{40}$/u.test(baseTree ?? "")) throw new Error("GitHub returned an invalid base tree.");

  const blobs = await Promise.all(files.map(({ content }) => github(`/repos/${encodedRepository}/git/blobs`, token, {
    method: "POST",
    body: { content, encoding: "utf-8" },
  })));
  const tree = await github(`/repos/${encodedRepository}/git/trees`, token, {
    method: "POST",
    body: {
      base_tree: baseTree,
      tree: files.map((file, index) => ({
        path: file.path,
        mode: "100644",
        type: "blob",
        sha: blobs[index].sha,
      })),
    },
  });
  if (!/^[a-f0-9]{40}$/u.test(tree?.sha ?? "")) throw new Error("GitHub returned an invalid setup tree.");

  let setupHead = await readObserveSetupHead(encodedRepository, token);
  if (!setupHead) {
    const commit = await github(`/repos/${encodedRepository}/git/commits`, token, {
      method: "POST",
      body: {
        message: `chore: install ChangePlane ${selectedHarness.mode} harness`,
        tree: tree.sha,
        parents: [baseSha],
      },
    });
    if (!/^[a-f0-9]{40}$/u.test(commit?.sha ?? "")) throw new Error("GitHub returned an invalid setup commit.");
    try {
      await github(`/repos/${encodedRepository}/git/refs`, token, {
        method: "POST",
        body: { ref: `refs/heads/${OBSERVE_SETUP_BRANCH}`, sha: commit.sha },
      });
    } catch (error) {
      if (!(error instanceof GitHubError) || error.status !== 422) throw error;
    }
    setupHead = await readObserveSetupHead(encodedRepository, token);
  }
  await assertObserveSetupHead(encodedRepository, setupHead, baseSha, tree.sha, token);

  try {
    const pullRequest = await github(`/repos/${encodedRepository}/pulls`, token, {
      method: "POST",
      body: {
        title: "chore: install ChangePlane harness",
        head: OBSERVE_SETUP_BRANCH,
        base: repo.default_branch,
        body: [
          `<!-- changeplane ${JSON.stringify(plan)} -->`,
          `## ChangePlane ${harnessModeLabel(selectedHarness.mode)} setup`,
          "",
          selectedHarness.mode === HARNESS_MODE.AUTONOMOUS
            ? "This installs the exact-revision harness. Fixable failed evidence may receive at most two bounded repair attempts within 15 minutes; protected, ambiguous, stale, or exhausted changes stop for a human."
            : selectedHarness.mode === HARNESS_MODE.VERIFY
              ? "This installs a blocking-capable exact-revision guard with no repair authority. Your coding agent owns any fix; ChangePlane rechecks the new commit and never claims that GitHub enforcement is active."
              : "This adds reporting only. It cannot block merges, run repair, or execute pull-request code with a write token.",
          "",
          `**Next:** review the ${files.length} added files, then merge to activate ChangePlane on future pull-request updates.`,
          "",
          `**Done when:** open or update one normal pull request, open its **Checks** tab, and choose \`ChangePlane / guard\`. **Neutral** means ChangePlane reported findings without changing merge rules. **Scope only** means the exact commit and files were checked, but no behavior test was bound. [Open this repository's pull requests](https://github.com/${repo.full_name}/pulls).`,
          "",
          behaviorEvidence ? `**Behavior check configured:** ${behaviorEvidence}` : "**Behavior checks: none configured**",
          behaviorEvidence
            ? "ChangePlane will bind this exact check result and publisher to each evaluated commit."
            : "ChangePlane receipts prove the exact commit and file scope only. The receipt will not claim that the code works.",
          "",
          "<details>",
          "<summary>Technical safety boundary</summary>",
          "",
          selectedHarness.mode === HARNESS_MODE.AUTONOMOUS
            ? "The proposal job receives no forge credentials. A clean harness validates the candidate patch, an App-signed one-time grant authorizes a separate apply job, and only a fresh exact-head check may publish PASS. GitHub remains the merge authority."
            : selectedHarness.mode === HARNESS_MODE.VERIFY
              ? "Verify only receives no provider key, repair webhook, controller HMAC, or installation credential. It publishes from exact deterministic evidence; repository branch policy remains the sole source of merge enforcement."
              : "ChangePlane binds each receipt to the pull request's exact head revision. Repair stays disabled until repository policy, provider funding, and the trusted controller are configured.",
          "",
          "</details>",
        ].join("\n"),
      },
    });
    return observeSetupResult(repo, pullRequest, { harnessMode: selectedHarness.mode });
  } catch (error) {
    if (error instanceof GitHubError && error.status === 422) {
      const pullRequest = await findObserveSetupPullRequest(encodedRepository, repo, token, files, plan);
      if (pullRequest) {
        await validateObserveSetupPullRequest(encodedRepository, pullRequest, baseSha, files, token);
        return observeSetupResult(repo, pullRequest, { harnessMode: selectedHarness.mode });
      }
    }
    throw error;
  }
}

async function readJson(req, { maxBytes = MAX_BODY_BYTES } = {}) {
  if (req.body && typeof req.body === "object") {
    if (Buffer.byteLength(JSON.stringify(req.body)) > maxBytes) throw new HttpError(413, "Request body is too large.");
    return req.body;
  }
  if (typeof req.body === "string") {
    if (Buffer.byteLength(req.body) > maxBytes) throw new HttpError(413, "Request body is too large.");
    try {
      const value = JSON.parse(req.body);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
      return value;
    } catch {
      throw new HttpError(400, "Request body must be a JSON object.");
    }
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new HttpError(413, "Request body is too large.");
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new HttpError(400, "Request body must be a JSON object.");
  }
}

function assertJsonRequest(req) {
  const contentType = String(header(req, "content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new HttpError(415, "Content-Type must be application/json.");
  }
}

function queryValue(req, name) {
  const value = req.query?.[name] ?? new URL(req.url, "https://changeplane.invalid").searchParams.get(name);
  if (Array.isArray(value)) throw new HttpError(400, `${name} must appear once.`);
  return value;
}

function sendJson(res, status, body, cookies = []) {
  res.statusCode = status;
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("x-content-type-options", "nosniff");
  if (cookies.length) res.setHeader("set-cookie", cookies);
  res.end(JSON.stringify(body));
}

function redirect(res, location, cookies = []) {
  res.statusCode = 302;
  res.setHeader("cache-control", "no-store");
  res.setHeader("location", location);
  if (cookies.length) res.setHeader("set-cookie", cookies);
  res.end();
}

function oauthConfiguration(req) {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!oauthIsConfigured()) throw new HttpError(503, "GitHub connection is not configured.");
  return {
    clientId,
    clientSecret,
    appSlug: githubAppSlug(),
    authMode: githubAppSlug() ? "github_app" : "oauth",
    redirectUri: `${configuredOrigin(req)}/api/github?action=callback`,
  };
}

function oauthChallenge() {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function authorizeUrl({ clientId, redirectUri, state, challenge, scopes = [] }) {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  if (scopes.length > 0) url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url;
}

function redirectCanaryOwnerError(req, res, reason) {
  const url = new URL(configuredOrigin(req));
  url.searchParams.set("access", "canary-owner");
  url.searchParams.set("github", reason);
  redirect(res, url.toString(), [clearCookie(OAUTH_COOKIE)]);
}

function redirectAuthorizationError(req, res, reason) {
  const url = new URL(configuredOrigin(req));
  if (rolloutMode() === "controlled_canary") url.searchParams.set("access", "canary-owner");
  url.searchParams.set("github", reason);
  redirect(res, url.toString(), [clearCookie(OAUTH_COOKIE)]);
}

async function login(req, res) {
  const configuration = oauthConfiguration(req);
  if (rolloutMode() === "controlled_canary") {
    throw new HttpError(403, "New GitHub App installations are disabled for this controlled canary.");
  }
  const state = randomBytes(32).toString("base64url");
  if (configuration.authMode === "github_app") {
    const stateCookie = seal({
      kind: "installation",
      state,
      redirectUri: configuration.redirectUri,
      authMode: configuration.authMode,
    }, sessionSecret(), {
      ttlMs: OAUTH_TTL_MS,
      purpose: "oauth",
    });
    const installUrl = new URL(`https://github.com/apps/${configuration.appSlug}/installations/new`);
    installUrl.searchParams.set("state", state);
    redirect(res, installUrl.toString(), [cookie(OAUTH_COOKIE, stateCookie, OAUTH_TTL_MS / 1000)]);
    return;
  }

  const { verifier, challenge } = oauthChallenge();
  const stateCookie = seal({
    kind: "oauth",
    state,
    redirectUri: configuration.redirectUri,
    authMode: configuration.authMode,
    verifier,
  }, sessionSecret(), {
    ttlMs: OAUTH_TTL_MS,
    purpose: "oauth",
  });
  const url = authorizeUrl({
    clientId: configuration.clientId,
    redirectUri: configuration.redirectUri,
    state,
    challenge,
    scopes: REQUIRED_SCOPES,
  });
  redirect(res, url.toString(), [cookie(OAUTH_COOKIE, stateCookie, OAUTH_TTL_MS / 1000)]);
}

async function authorizeExisting(req, res) {
  const configuration = oauthConfiguration(req);
  if (configuration.authMode !== "github_app") {
    throw new HttpError(404, "GitHub App authorization is not configured.");
  }
  const state = randomBytes(32).toString("base64url");
  const { verifier, challenge } = oauthChallenge();
  const stateCookie = seal({
    kind: "oauth",
    state,
    redirectUri: configuration.redirectUri,
    authMode: "github_app",
    existingInstallation: true,
    verifier,
  }, sessionSecret(), {
    ttlMs: OAUTH_TTL_MS,
    purpose: "oauth",
  });
  const url = authorizeUrl({
    clientId: configuration.clientId,
    redirectUri: configuration.redirectUri,
    state,
    challenge,
  });
  redirect(res, url.toString(), [cookie(OAUTH_COOKIE, stateCookie, OAUTH_TTL_MS / 1000)]);
}

async function installation(req, res) {
  const configuration = oauthConfiguration(req);
  if (rolloutMode() === "controlled_canary") {
    throw new HttpError(403, "New GitHub App installations are disabled for this controlled canary.");
  }
  if (configuration.authMode !== "github_app") throw new HttpError(404, "GitHub App installation is not configured.");
  const installationId = queryValue(req, "installation_id");
  const state = queryValue(req, "state");
  if (typeof installationId !== "string" || !/^[1-9][0-9]{0,19}$/u.test(installationId)) {
    throw new HttpError(400, "Invalid GitHub App installation.");
  }
  if (typeof state !== "string" || !/^[A-Za-z0-9_-]{32,128}$/u.test(state)) {
    throw new HttpError(400, "Invalid GitHub App installation state.");
  }
  const rawStateCookie = parseCookies(header(req, "cookie"))[OAUTH_COOKIE];
  let saved;
  try {
    saved = unseal(rawStateCookie, sessionSecret(), { purpose: "oauth" });
  } catch {
    throw new HttpError(400, "GitHub App installation state expired or is invalid.");
  }
  if (saved.kind !== "installation" || saved.authMode !== "github_app" || !constantTimeEqual(state, saved.state)) {
    throw new HttpError(400, "GitHub App installation state mismatch.");
  }
  if (saved.redirectUri !== configuration.redirectUri) throw new HttpError(400, "OAuth redirect mismatch.");

  const oauthState = randomBytes(32).toString("base64url");
  const { verifier, challenge } = oauthChallenge();
  const stateCookie = seal({
    kind: "oauth",
    state: oauthState,
    redirectUri: configuration.redirectUri,
    authMode: "github_app",
    installationId,
    verifier,
  }, sessionSecret(), {
    ttlMs: OAUTH_TTL_MS,
    purpose: "oauth",
  });
  const url = authorizeUrl({
    clientId: configuration.clientId,
    redirectUri: configuration.redirectUri,
    state: oauthState,
    challenge,
  });
  redirect(res, url.toString(), [cookie(OAUTH_COOKIE, stateCookie, OAUTH_TTL_MS / 1000)]);
}

async function userInstallations(token) {
  const installations = [];
  for (let page = 1; page <= 10; page += 1) {
    const payload = await github(`/user/installations?per_page=100&page=${page}`, token);
    const batch = payload?.installations;
    if (!Array.isArray(batch)) throw new HttpError(502, "GitHub returned an invalid installation list.");
    installations.push(...batch);
    if (batch.length < 100) break;
  }
  return installations;
}

function missingRequiredInstallationPermissions(installation) {
  return Object.entries(REQUIRED_GITHUB_APP_PERMISSIONS)
    .filter(([permission, level]) => {
      const actual = installation?.permissions?.[permission];
      return level === "write" ? actual !== "write" : !["read", "write"].includes(actual);
    })
    .map(([permission]) => permission);
}

async function installationCanWriteSecrets(session, installationId) {
  if (session.authMode !== "github_app") return true;
  if (typeof session.byokSecretWrite === "boolean") return session.byokSecretWrite;
  if (!/^[1-9][0-9]{0,19}$/u.test(String(installationId ?? ""))) return false;
  const installations = await userInstallations(session.token);
  const installation = installations.find(({ id }) => String(id) === String(installationId));
  return installation?.permissions?.secrets === "write";
}

async function repositoryByokToken(session, repo, installationId) {
  if (session.authMode !== "github_app") return session.token;
  if (!Number.isSafeInteger(repo?.id) || repo.id <= 0) {
    throw new HttpError(502, "GitHub returned an invalid repository identifier.");
  }
  try {
    return await createSecretsWriteInstallationAccessToken({
      appId: process.env.GITHUB_APP_ID,
      privateKey: process.env.GITHUB_APP_PRIVATE_KEY,
      installationId: Number(installationId),
      repositoryId: repo.id,
      request: (pathname, token, options) => github(pathname, token, options),
    });
  } catch {
    throw new HttpError(503, "GitHub App secret storage is not available. Reconnect the App or contact the repository owner.");
  }
}

async function callback(req, res) {
  const state = queryValue(req, "state");
  if (typeof state !== "string" || !/^[A-Za-z0-9_-]{32,128}$/u.test(state)) throw new HttpError(400, "Invalid OAuth state.");
  const rawStateCookie = parseCookies(header(req, "cookie"))[OAUTH_COOKIE];
  let saved;
  try {
    saved = unseal(rawStateCookie, sessionSecret(), { purpose: "oauth" });
  } catch {
    throw new HttpError(400, "OAuth state expired or is invalid.");
  }
  if (saved.kind !== "oauth" || !constantTimeEqual(state, saved.state)) throw new HttpError(400, "OAuth state mismatch.");

  const authorizationError = queryValue(req, "error");
  if (authorizationError) {
    if (authorizationError === "access_denied") {
      redirectAuthorizationError(req, res, "authorization_cancelled");
      return;
    }
    redirectAuthorizationError(req, res, "authorization_failed");
    return;
  }

  const code = queryValue(req, "code");
  if (typeof code !== "string" || !/^[A-Za-z0-9_-]{8,256}$/u.test(code)) throw new HttpError(400, "Invalid OAuth code.");
  if (
    rolloutMode() === "controlled_canary"
    && saved.authMode === "github_app"
    && saved.existingInstallation !== true
  ) {
    throw new HttpError(403, "New GitHub App installations are disabled for this controlled canary.");
  }

  const configuration = oauthConfiguration(req);
  if (saved.authMode !== configuration.authMode || typeof saved.verifier !== "string") {
    throw new HttpError(400, "GitHub connection mode changed during authorization.");
  }
  if (saved.redirectUri !== configuration.redirectUri) throw new HttpError(400, "OAuth redirect mismatch.");
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", "user-agent": "changeplane-installer/0.1" },
    body: JSON.stringify({
      client_id: configuration.clientId,
      client_secret: configuration.clientSecret,
      code,
      redirect_uri: configuration.redirectUri,
      code_verifier: saved.verifier,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new HttpError(502, "GitHub OAuth exchange failed.");
  const exchange = await response.json();
  if (typeof exchange.access_token !== "string" || !exchange.access_token) {
    throw new HttpError(400, "GitHub did not grant access.");
  }
  const granted = new Set(String(exchange.scope ?? "").split(",").map((scope) => scope.trim()).filter(Boolean));
  if (configuration.authMode === "oauth" && !REQUIRED_SCOPES.every((scope) => granted.has(scope))) {
    throw new HttpError(403, "GitHub did not grant the required repo and workflow scopes.");
  }
  const user = await github("/user", exchange.access_token);
  if (typeof user?.login !== "string" || !user.login) throw new HttpError(502, "GitHub returned an invalid user profile.");
  let installationIds = [];
  if (configuration.authMode === "github_app") {
    const installations = await userInstallations(exchange.access_token);
    const matching = installations.filter(({ id, app_slug: appSlug }) => (
      appSlug === configuration.appSlug || String(id) === String(saved.installationId ?? "")
    ));
    if (matching.length === 0) {
      if (saved.existingInstallation === true) {
        if (rolloutMode() === "controlled_canary") {
          redirectCanaryOwnerError(req, res, "owner_required");
          return;
        }
        redirectAuthorizationError(req, res, "installation_missing");
        return;
      }
      redirectAuthorizationError(req, res, "installation_unavailable");
      return;
    }
    const selectedInstallation = saved.installationId == null
      ? null
      : matching.find(({ id }) => String(id) === String(saved.installationId));
    if (saved.installationId != null && !selectedInstallation) {
      redirectAuthorizationError(req, res, "installation_unavailable");
      return;
    }
    const invalidSelectedPermissions = selectedInstallation
      ? missingRequiredInstallationPermissions(selectedInstallation)
      : [];
    if (invalidSelectedPermissions.length > 0) {
      redirectAuthorizationError(req, res, "permissions_required");
      return;
    }
    const validInstallations = matching.filter((installation) => (
      missingRequiredInstallationPermissions(installation).length === 0
    ));
    if (validInstallations.length === 0) {
      redirectAuthorizationError(req, res, "permissions_required");
      return;
    }
    installationIds = validInstallations
      .map(({ id }) => String(id))
      .filter((value) => /^[1-9][0-9]{0,19}$/u.test(value))
      .slice(0, MAX_APP_INSTALLATIONS);
  }

  const providerTtlMs = Number.isFinite(exchange.expires_in) && exchange.expires_in > 0
    ? exchange.expires_in * 1000
    : SESSION_TTL_MS;
  const ttlMs = Math.min(SESSION_TTL_MS, providerTtlMs);

  const session = seal({
    kind: "session",
    token: exchange.access_token,
    login: user.login,
    csrf: randomBytes(32).toString("base64url"),
    authMode: configuration.authMode,
    ...(configuration.authMode === "github_app" ? {
      installationId: installationIds[0],
      installationIds,
    } : {}),
  }, sessionSecret(), { ttlMs });
  redirect(res, `${configuredOrigin(req)}/?github=connected`, [
    clearCookie(OAUTH_COOKIE),
    cookie(SESSION_COOKIE, session, ttlMs / 1000),
  ]);
}

async function repositories(req, res) {
  const session = requireSession(req);
  const mode = rolloutMode();
  const allowedRepositories = allowedRolloutRepositories();
  if (mode !== "self_serve" && !allowedRepositories) {
    const variable = mode === "private_alpha"
      ? "CHANGEPLANE_ALPHA_REPOSITORIES_JSON"
      : "CHANGEPLANE_CANARY_REPOSITORY";
    throw new HttpError(503, `${variable} must contain the exact approved repository scope. No GitHub request was made.`);
  }
  const canaryRepository = mode === "controlled_canary" ? allowedRepositories[0] : null;
  const repos = [];
  if (canaryRepository) {
    const { repo } = await requireWritableRepository(canaryRepository, session);
    repos.push(repo);
  } else if (session.authMode === "github_app") {
    repos.push(...await installationRepositories(session));
  } else {
    for (let page = 1; page <= 10; page += 1) {
      const batch = await github(`/user/repos?affiliation=owner,collaborator,organization_member&sort=updated&per_page=100&page=${page}`, session.token);
      if (!Array.isArray(batch)) throw new HttpError(502, "GitHub returned an invalid repository list.");
      repos.push(...batch);
      if (batch.length < 100) break;
    }
  }
  sendJson(res, 200, {
    repositories: repos
      .filter((repo) => repo?.permissions?.push || repo?.permissions?.admin)
      .filter((repo) => !allowedRepositories || allowedRepositories.some(
        (allowed) => repo?.full_name?.toLowerCase() === allowed.toLowerCase(),
      ))
      .map((repo) => ({
        fullName: repo.full_name,
        private: Boolean(repo.private),
        defaultBranch: repo.default_branch,
        permissions: { push: Boolean(repo.permissions?.push), admin: Boolean(repo.permissions?.admin) },
      })),
  });
}

async function readByokStatus(repository, token) {
  const encodedRepository = encodeRepository(repository);
  try {
    const secret = await github(`/repos/${encodedRepository}/actions/secrets/${BYOK_SECRET_NAME}`, token);
    return {
      configured: true,
      state: "connected",
      secretName: BYOK_SECRET_NAME,
      updatedAt: typeof secret?.updated_at === "string" ? secret.updated_at : null,
    };
  } catch (error) {
    if (error instanceof GitHubError && error.status === 404) {
      return { configured: false, state: "not_connected", secretName: BYOK_SECRET_NAME, updatedAt: null };
    }
    throw error;
  }
}

async function readCurrentManagedRuntimeProfile(encodedRepository, baseSha, manifest, policy, token) {
  const commit = await github(`/repos/${encodedRepository}/git/commits/${baseSha}`, token);
  const treeSha = commit?.tree?.sha;
  if (!/^[a-f0-9]{40}$/u.test(treeSha ?? "")) {
    throw new HttpError(409, "ChangePlane could not bind the managed runtime to the default-branch tree.");
  }
  const tree = await github(`/repos/${encodedRepository}/git/trees/${treeSha}?recursive=1`, token);
  if (tree?.truncated || !Array.isArray(tree?.tree)) {
    throw new HttpError(409, "ChangePlane could not verify every reserved managed path on the exact default-branch revision.");
  }
  const installation = classifyManagedRuntimeTree({ manifest, policy, treeEntries: tree.tree });
  if (installation.state !== "current") {
    throw new HttpError(
      409,
      `ChangePlane managed files are incomplete, modified, or profile-expanded outside a protected pull request: ${installation.conflicts.join(", ")}. Run repository preflight before changing runtime authority.`,
    );
  }
  return installation.managedProfile;
}

async function readRepositoryRuntime(encodedRepository, repo, token) {
  if (typeof repo.default_branch !== "string" || !repo.default_branch) {
    throw new HttpError(409, "Repository has no default branch.");
  }
  const ref = await github(`/repos/${encodedRepository}/git/ref/heads/${encodeRef(repo.default_branch)}`, token);
  const baseSha = ref?.object?.sha;
  if (!/^[a-f0-9]{40}$/u.test(baseSha ?? "")) throw new Error("GitHub returned an invalid default-branch revision.");
  const content = await readRepositoryFile(encodedRepository, POLICY_PATH, baseSha, token);
  const manifestContent = await readRepositoryFile(encodedRepository, MANAGED_MANIFEST_PATH, baseSha, token);
  if (content == null && manifestContent == null) {
    return {
      baseSha,
      content: null,
      model: DEFAULT_PROPOSAL_MODEL,
      configured: false,
      harness: harnessPolicy(),
      managedProfile: null,
      requiredCheckCount: 0,
      requiredChecks: [],
    };
  }
  if (typeof content !== "string" || typeof manifestContent !== "string") {
    throw new HttpError(409, "ChangePlane setup is incomplete on the exact default-branch revision. Run repository preflight before configuring runtime authority.");
  }
  const managedProfile = await readCurrentManagedRuntimeProfile(
    encodedRepository,
    baseSha,
    manifestContent,
    content,
    token,
  );
  let policy;
  try {
    policy = JSON.parse(content);
  } catch {
    throw new HttpError(409, `${POLICY_PATH} is not valid JSON. Runtime configuration is unavailable.`);
  }
  let model = DEFAULT_PROPOSAL_MODEL;
  let configured = false;
  if (policy?.runtime?.provider === RUNTIME_PROVIDER) {
    model = validateRuntimeModel(policy.runtime.model);
    configured = policy.runtime.secretName === BYOK_SECRET_NAME
      && policy.runtime.reasoningEffort === PROPOSAL_REASONING_EFFORT;
  }
  let harness;
  try {
    harness = harnessPolicy(policy?.harness);
  } catch (error) {
    throw new HttpError(409, error instanceof Error ? error.message : "Harness policy is invalid.");
  }
  let requiredChecks;
  try {
    requiredChecks = validateRequiredChecks(policy?.evidence?.requiredChecks, {
      mode: harness.mode === HARNESS_MODE.OBSERVE ? "observe" : "enforce",
    });
  } catch {
    throw new HttpError(409, "Repository evidence checks are malformed. Runtime assurance is unavailable until the trusted policy is repaired.");
  }
  const requiredCheckCount = requiredChecks.length;
  return { baseSha, content, model, configured, harness, managedProfile, requiredCheckCount, requiredChecks };
}

async function requireMatchingManagedRuntime(encodedRepository, repo, token, expected) {
  const baseSha = expected?.baseSha;
  const managedProfile = expected?.managedProfile;
  if (!/^[a-f0-9]{40}$/u.test(baseSha ?? "") || !Object.values(MANAGED_PROFILE).includes(managedProfile)) {
    throw new HttpError(409, "An exact managed-runtime authority anchor is required before a repository secret can be changed.");
  }
  const current = await readRepositoryRuntime(encodedRepository, repo, token);
  if (!current.content || current.baseSha !== baseSha || current.managedProfile !== managedProfile) {
    throw new HttpError(409, "The default branch or managed payload changed after runtime verification. No repository secret was changed; recheck the repository and retry.");
  }
  return current;
}

async function requireAutonomousAuthorityAnchor(session, target, authorityAnchor) {
  if (authorityAnchor?.state !== "managed") {
    throw new HttpError(409, "An exact installed managed-runtime authority anchor is required before autonomous repair can be enabled.");
  }
  await requireMatchingManagedRuntime(
    target.encodedRepository,
    target.repo,
    session.token,
    authorityAnchor,
  );
  return {
    state: "managed",
    baseSha: authorityAnchor.baseSha,
    managedProfile: authorityAnchor.managedProfile,
  };
}

async function validateRuntimePullRequest(
  encodedRepository,
  pullRequest,
  baseSha,
  headSha,
  treeSha,
  token,
  expectedFiles = [{ path: POLICY_PATH }],
) {
  if (!Number.isSafeInteger(pullRequest?.number) || typeof pullRequest?.html_url !== "string"
    || pullRequest?.head?.sha !== headSha || pullRequest?.base?.sha !== baseSha) {
    throw new HttpError(409, "The runtime configuration pull request is not bound to the expected revisions.");
  }
  const branchHead = await readBranchHead(encodedRepository, RUNTIME_CONFIG_BRANCH, token);
  if (branchHead !== headSha) throw new HttpError(409, "The runtime configuration branch changed unexpectedly.");
  const commit = await github(`/repos/${encodedRepository}/git/commits/${headSha}`, token);
  if (commit?.tree?.sha !== treeSha || commit?.parents?.length !== 1 || commit.parents[0]?.sha !== baseSha) {
    throw new HttpError(409, "The runtime configuration commit is not based on the current default branch.");
  }
  const comparison = await github(`/repos/${encodedRepository}/compare/${baseSha}...${headSha}`, token);
  const expectedPaths = expectedFiles.map(({ path: filePath }) => filePath).sort();
  const actualPaths = Array.isArray(comparison?.files)
    ? comparison.files.map(({ filename }) => filename).sort()
    : [];
  if (comparison?.ahead_by !== 1 || comparison?.behind_by !== 0 || comparison?.total_commits !== 1
    || JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
    throw new HttpError(409, "The runtime configuration pull request contains unexpected files.");
  }
}

async function createRuntimePullRequest(repository, session, model, harnessMode) {
  const { encodedRepository, repo } = await requireWritableRepository(repository, session);
  const runtime = await readRepositoryRuntime(encodedRepository, repo, session.token);
  if (!runtime.content) throw new HttpError(409, "Merge the ChangePlane setup pull request before choosing a proposal model.");
  const selectedModel = validateRuntimeModel(model ?? runtime.model);
  const selectedHarness = harnessPolicy({ mode: harnessMode ?? runtime.harness.mode });
  const expandsToAutonomous = runtime.managedProfile === MANAGED_PROFILE.VERIFY_LITE
    && selectedHarness.mode === HARNESS_MODE.AUTONOMOUS;
  if (selectedHarness.mode === HARNESS_MODE.AUTONOMOUS) {
    await prepareAutonomousHarness(repository, session, {
      state: "managed",
      baseSha: runtime.baseSha,
      managedProfile: runtime.managedProfile,
    });
  }
  let updatedPolicy = buildRuntimePolicy(runtime.content, selectedModel, selectedHarness.mode);
  if (expandsToAutonomous) {
    const policy = JSON.parse(updatedPolicy);
    policy.review = {
      mode: "advisory",
      maxFindings: 5,
      memoryPath: ASSURANCE_MEMORY_PATH,
    };
    updatedPolicy = `${JSON.stringify(policy, null, 2)}\n`;
  }
  const desiredFiles = expandsToAutonomous
    ? (() => {
      const fullManagedFiles = buildManagedFiles(MANAGED_PROFILE.FULL);
      return [
        ...fullManagedFiles,
        {
          path: MANAGED_MANIFEST_PATH,
          content: managedManifestContent(fullManagedFiles, MANAGED_PROFILE.FULL),
        },
        { path: ASSURANCE_MEMORY_PATH, content: ASSURANCE_MEMORY_TEMPLATE },
        { path: POLICY_PATH, content: updatedPolicy },
      ];
    })()
    : [{ path: POLICY_PATH, content: updatedPolicy }];
  const currentContents = await Promise.all(desiredFiles.map(({ path: filePath }) => (
    filePath === POLICY_PATH
      ? runtime.content
      : readRepositoryFile(encodedRepository, filePath, runtime.baseSha, session.token)
  )));
  const changedFiles = desiredFiles.filter((file, index) => currentContents[index] !== file.content);
  if (changedFiles.length === 0) {
    return {
      repository,
      operation: "current",
      model: selectedModel,
      harnessMode: selectedHarness.mode,
      managedProfile: runtime.managedProfile,
      state: "current",
    };
  }
  const changesModel = selectedModel !== runtime.model;
  const changesHarness = selectedHarness.mode !== runtime.harness.mode;
  const changeLabel = expandsToAutonomous
    ? "the protected Autonomous payload"
    : changesModel && changesHarness
      ? `${selectedModel} and ${selectedHarness.mode} mode`
      : changesHarness ? `${selectedHarness.mode} harness mode` : selectedModel;

  const baseCommit = await github(`/repos/${encodedRepository}/git/commits/${runtime.baseSha}`, session.token);
  const baseTree = baseCommit?.tree?.sha;
  if (!/^[a-f0-9]{40}$/u.test(baseTree ?? "")) throw new Error("GitHub returned an invalid default-branch tree.");
  const blobs = await Promise.all(changedFiles.map(({ content }) => github(
    `/repos/${encodedRepository}/git/blobs`,
    session.token,
    { method: "POST", body: { content, encoding: "utf-8" } },
  )));
  const tree = await github(`/repos/${encodedRepository}/git/trees`, session.token, {
    method: "POST",
    body: {
      base_tree: baseTree,
      tree: changedFiles.map((file, index) => ({
        path: file.path,
        mode: "100644",
        type: "blob",
        sha: blobs[index].sha,
      })),
    },
  });
  if (!/^[a-f0-9]{40}$/u.test(tree?.sha ?? "")) throw new Error("GitHub returned an invalid runtime configuration tree.");

  let headSha = await readBranchHead(encodedRepository, RUNTIME_CONFIG_BRANCH, session.token);
  if (!headSha) {
    const commit = await github(`/repos/${encodedRepository}/git/commits`, session.token, {
      method: "POST",
      body: {
        message: `chore: use ${changeLabel} in ChangePlane`,
        tree: tree.sha,
        parents: [runtime.baseSha],
      },
    });
    if (!/^[a-f0-9]{40}$/u.test(commit?.sha ?? "")) throw new Error("GitHub returned an invalid runtime configuration commit.");
    try {
      await github(`/repos/${encodedRepository}/git/refs`, session.token, {
        method: "POST",
        body: { ref: `refs/heads/${RUNTIME_CONFIG_BRANCH}`, sha: commit.sha },
      });
    } catch (error) {
      if (!(error instanceof GitHubError) || error.status !== 422) throw error;
    }
    headSha = await readBranchHead(encodedRepository, RUNTIME_CONFIG_BRANCH, session.token);
  }
  if (!/^[a-f0-9]{40}$/u.test(headSha ?? "")) throw new Error("GitHub returned an invalid runtime configuration branch.");

  let pullRequest;
  try {
    pullRequest = await github(`/repos/${encodedRepository}/pulls`, session.token, {
      method: "POST",
      body: {
        title: `chore: configure ChangePlane ${changeLabel}`,
        head: RUNTIME_CONFIG_BRANCH,
        base: repo.default_branch,
        body: [
          expandsToAutonomous ? "## ChangePlane Autonomous payload upgrade" : "## ChangePlane runtime policy",
          "",
          expandsToAutonomous
            ? `This expands Verify Lite through one reviewable pull request. It adds the proposal, review, and separately credentialed controller files, replaces the guard workflow with the full managed profile, and selects \`${selectedModel}\`.`
            : `This changes only \`${POLICY_PATH}\` and selects \`${selectedModel}\` with the \`${selectedHarness.mode}\` exact-revision harness.`,
          "",
          selectedHarness.mode === HARNESS_MODE.AUTONOMOUS
            ? "Fixable failed evidence may receive at most two attempts within 15 minutes. The model still receives no forge write, Check, approval, or merge authority."
            : selectedHarness.mode === HARNESS_MODE.VERIFY
              ? "Verify only publishes a blocking-capable exact-revision guard without dispatching repair. Your coding agent owns the fix; GitHub branch policy remains the merge authority."
              : "Observe mode publishes a neutral exact-revision receipt and does not dispatch repair.",
          "",
          expandsToAutonomous
            ? `Review all ${changedFiles.length} managed changes. Until this pull request is merged, Verify Lite remains active and no repair workflow can run.`
            : "Closing this pull request keeps the current runtime unchanged.",
        ].join("\n"),
      },
    });
  } catch (error) {
    if (!(error instanceof GitHubError) || error.status !== 422) throw error;
    const owner = repo.full_name.split("/")[0];
    const pulls = await github(
      `/repos/${encodedRepository}/pulls?state=open&base=${encodeURIComponent(repo.default_branch)}&head=${encodeURIComponent(`${owner}:${RUNTIME_CONFIG_BRANCH}`)}&per_page=10`,
      session.token,
    );
    pullRequest = Array.isArray(pulls) && pulls.length === 1 ? pulls[0] : null;
    if (!pullRequest) throw new HttpError(409, `Branch ${RUNTIME_CONFIG_BRANCH} already exists without one verifiable pull request.`);
  }
  await validateRuntimePullRequest(
    encodedRepository,
    pullRequest,
    runtime.baseSha,
    headSha,
    tree.sha,
    session.token,
    changedFiles,
  );
  return {
    repository,
    branch: RUNTIME_CONFIG_BRANCH,
    operation: expandsToAutonomous ? "autonomous-upgrade" : "runtime",
    model: selectedModel,
    harnessMode: selectedHarness.mode,
    managedProfile: expandsToAutonomous ? MANAGED_PROFILE.FULL : runtime.managedProfile,
    state: "pending",
    pullRequest: { number: pullRequest.number, url: pullRequest.html_url, state: pullRequest.state },
  };
}

async function runtimeStatus(req, res) {
  const session = requireSession(req);
  const repository = validateRepository(queryValue(req, "repository"));
  const { encodedRepository, repo, installationId } = await requireWritableRepository(repository, session);
  const runtime = await readRepositoryRuntime(encodedRepository, repo, session.token);
  const live = await github(`/repos/${encodedRepository}`, session.token);
  const isAdmin = live?.full_name?.toLowerCase() === repository.toLowerCase()
    && live.permissions?.admin === true;
  const branchEnforcement = runtime.content == null
    ? {
      state: "not_installed",
      active: false,
      strict: false,
      guardRequired: false,
      publisherBound: false,
    }
    : await readGuardEnforcement(
      encodedRepository,
      { ...repo, ...live },
      session.token,
      { isAdmin, requiredChecks: runtime.requiredChecks },
    );
  const enforcement = runtime.harness.mode === HARNESS_MODE.OBSERVE && branchEnforcement.active
    ? { ...branchEnforcement, state: "verify_mode_required", active: false }
    : branchEnforcement;
  const canWriteSecrets = isAdmin && await installationCanWriteSecrets(session, installationId);
  const byok = !isAdmin
    ? { configured: false, state: "admin_required", secretName: BYOK_SECRET_NAME, updatedAt: null }
    : !canWriteSecrets
      ? { configured: false, state: "permission_required", secretName: BYOK_SECRET_NAME, updatedAt: null }
      : await readByokStatus(repository, await repositoryByokToken(session, { ...repo, ...live }, installationId));
  const controller = repairControllerConfiguration();
  let managed = {
    state: "reserved",
    available: false,
    providerVerified: false,
    executionReady: false,
  };
  const managedKey = process.env[MANAGED_API_KEY_NAME];
  if (managedKey) {
    try {
      await verifyOpenAIKey(managedKey, { model: runtime.model });
      managed = {
        state: "provider_verified",
        available: false,
        providerVerified: true,
        executionReady: false,
      };
    } catch {
      managed = {
        state: "configuration_error",
        available: false,
        providerVerified: false,
        executionReady: false,
      };
    }
  }
  const autonomousReady = isAdmin
    && runtime.managedProfile === MANAGED_PROFILE.FULL
    && runtime.harness.mode === HARNESS_MODE.AUTONOMOUS
    && byok.configured
    && controller.configured
    && enforcement.active;
  const sdlc = buildSdlcAssurance({
    installed: runtime.content != null,
    managedProfile: runtime.managedProfile,
    harnessMode: runtime.harness.mode,
    requiredCheckCount: runtime.requiredCheckCount,
    enforcement,
    autonomousReady,
    maxAttempts: HARNESS_MAX_ATTEMPTS,
  });
  sendJson(res, 200, {
    repository,
    provider: RUNTIME_PROVIDER,
    model: runtime.model,
    activeModel: runtime.model,
    modelConfigured: runtime.configured,
    effort: PROPOSAL_REASONING_EFFORT,
    harness: {
      mode: runtime.harness.mode,
      managedProfile: runtime.managedProfile,
      verifyAvailable: true,
      autonomousAvailable: isAdmin && controller.provisioningConfigured && session.authMode === "github_app" && canWriteSecrets,
      autonomousUpgradeRequired: runtime.managedProfile === MANAGED_PROFILE.VERIFY_LITE,
      ready: autonomousReady,
      enforcement,
      maxAttempts: HARNESS_MAX_ATTEMPTS,
      budgetMinutes: HARNESS_BUDGET_MINUTES,
    },
    managed,
    byok,
    sdlc,
  });
}

function proofCheckRunId(value) {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,15}$/u.test(value)) {
    throw new HttpError(400, "checkRunId must be one positive GitHub Check Run identifier.");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new HttpError(400, "checkRunId is outside the supported range.");
  return parsed;
}

function proofPassportDigest(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new HttpError(400, "passportDigest must be the exact SHA-256 digest from the proof locator.");
  }
  return value;
}

const GUARD_PUBLISHER_AUDIENCE = "https://changeplane.vercel.app/guard-publisher/v1";
const GUARD_WORKFLOW_PATH = ".github/workflows/changeplane.yml";
const GUARD_PULL_REQUEST_EVENTS = Object.freeze([
  "pull_request_target",
  "pull_request_review",
  "deployment_status",
  "repository_dispatch",
]);

function guardPublisherConfiguration() {
  const publisher = configuredGuardPublisher();
  const { privateKey } = guardPublisherEnvironment();
  if (!publisher || !guardPublisherIsConfigured()) {
    throw new HttpError(503, "The dedicated ChangePlane guard publisher is not configured.");
  }
  return { ...publisher, privateKey };
}

function guardPublisherBearer(req) {
  const value = header(req, "authorization");
  const match = typeof value === "string" ? value.match(/^Bearer ([A-Za-z0-9._-]{100,20000})$/u) : null;
  if (!match) throw new HttpError(401, "A GitHub OIDC bearer token is required.");
  return match[1];
}

function guardPolicyEvidenceMatches(passport, requiredChecks) {
  if (!Array.isArray(requiredChecks) || !Array.isArray(passport?.evidence)) return false;
  const policy = requiredChecks.map((requirement) => (
    typeof requirement === "string"
      ? `${requirement}\0Any`
      : `${requirement.name}\0${requirement.appSlug}`
  )).sort();
  const recorded = passport.evidence.map((item) => `${item.checkName}\0${item.expectedPublisher}`).sort();
  return policy.length === recorded.length
    && policy.every((identity, index) => identity === recorded[index]);
}

function assertGuardPublisherRolloutScope(repository) {
  try {
    assertRepositoryRolloutScope(repository, { external: true });
  } catch (error) {
    if (error instanceof HttpError && error.status === 403) {
      throw new HttpError(403, rolloutMode() === "private_alpha"
        ? "This guard publisher can access only an invited alpha repository. No external request was made."
        : "This guard publisher can access only its approved canary repository. No external request was made.");
    }
    throw error;
  }
}

function evidenceCheckMatchesPassport(check, item) {
  return check?.id === item.checkRunId
    && check.name === item.checkName
    && check.head_sha === item.headSha
    && String(check.status ?? "").toUpperCase() === item.status
    && String(check.conclusion ?? "").toUpperCase() === item.conclusion
    && check.completed_at === item.completedAt
    && check.app?.id === item.publisherAppId
    && check.app?.slug === item.actualPublisher;
}

function newestEligibleEvidenceCheck(checks, item) {
  const publisher = item.expectedPublisher === "Any"
    ? item.actualPublisher
    : item.expectedPublisher;
  const eligible = checks.filter((check) => (
    check?.name === item.checkName
    && check?.head_sha === item.headSha
    && check?.app?.slug === publisher
  ));
  let newest = null;
  let newestStartedAt = null;
  for (const check of eligible) {
    if (!Number.isSafeInteger(check?.id) || check.id <= 0) {
      throw new TypeError("GitHub returned an invalid eligible Check Run identifier.");
    }
    const startedAt = Date.parse(check.started_at ?? check.completed_at ?? "");
    if (!Number.isFinite(startedAt)) {
      throw new TypeError("GitHub returned an eligible Check Run without a valid started_at or completed_at timestamp.");
    }
    if (newest === null || startedAt > newestStartedAt
      || (startedAt === newestStartedAt && check.id > newest.id)) {
      newest = check;
      newestStartedAt = startedAt;
    }
  }
  return newest;
}

async function listEvidenceChecksByName(encodedRepository, headSha, checkName, token) {
  const checks = [];
  for (let page = 1; page <= 10; page += 1) {
    const payload = await github(
      `/repos/${encodedRepository}/commits/${headSha}/check-runs?check_name=${encodeURIComponent(checkName)}&filter=all&per_page=100&page=${page}`,
      token,
    );
    if (!Array.isArray(payload?.check_runs)) {
      throw new TypeError("GitHub returned an invalid Check Run list.");
    }
    checks.push(...payload.check_runs);
    if (payload.check_runs.length < 100) return checks;
  }
  throw new TypeError("GitHub returned too many Check Runs to prove the latest eligible evidence safely.");
}

function canonicalGithubActionsRunId(detailsUrl, repository) {
  if (typeof detailsUrl !== "string"
    || typeof repository !== "string"
    || !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/u.test(repository)) return null;
  let parsed;
  try {
    parsed = new URL(detailsUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com" || parsed.port
    || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
  const prefix = `/${repository}/actions/runs/`;
  if (!parsed.pathname.startsWith(prefix)) return null;
  const match = parsed.pathname.slice(prefix.length).match(/^([1-9][0-9]{0,19})(?:\/job\/[1-9][0-9]{0,19})?$/u);
  return match?.[1] ?? null;
}

function requiredWorkflowPaths(requiredChecks) {
  const paths = new Map();
  if (!Array.isArray(requiredChecks)) return paths;
  for (const requirement of requiredChecks) {
    if (requirement?.appSlug === "github-actions" && validGithubWorkflowPath(requirement.workflowPath)) {
      paths.set(`${requirement.name}\0${requirement.appSlug}`, requirement.workflowPath);
    }
  }
  return paths;
}

async function githubActionsWorkflowMatches({
  encodedRepository,
  repository,
  headSha,
  check,
  workflowPath,
  token,
  runCache,
}) {
  if (!workflowPath) return true;
  if (check?.head_sha !== headSha || check?.app?.slug !== "github-actions") return false;
  const runId = canonicalGithubActionsRunId(check?.details_url, repository);
  if (!runId) return false;
  if (!runCache.has(runId)) {
    runCache.set(runId, github(`/repos/${encodedRepository}/actions/runs/${runId}`, token)
      .catch((error) => {
        if (error instanceof GitHubError && error.status === 404) return null;
        throw error;
      }));
  }
  const run = await runCache.get(runId);
  return String(run?.id ?? "") === runId
    && run?.head_sha === headSha
    && githubWorkflowFilePath(run?.path) === workflowPath;
}

async function evidenceFreshnessObservations(encodedRepository, passport, token, requiredChecks = []) {
  const seen = new Set();
  for (const item of passport.evidence) {
    if (!Number.isSafeInteger(item.checkRunId) || item.checkRunId <= 0 || seen.has(item.checkRunId)) {
      throw new HttpError(409, "Guard evidence cannot be re-fetched as unique GitHub Check Runs.");
    }
    seen.add(item.checkRunId);
  }
  const recordedChecks = await Promise.all(passport.evidence.map((item) => (
    github(`/repos/${encodedRepository}/check-runs/${item.checkRunId}`, token)
  )));
  const checksByName = new Map();
  await Promise.all([...new Set(passport.evidence.map((item) => item.checkName))].map(async (checkName) => {
    checksByName.set(checkName, await listEvidenceChecksByName(
      encodedRepository,
      passport.target.headSha,
      checkName,
      token,
    ));
  }));
  const workflows = requiredWorkflowPaths(requiredChecks);
  const runCache = new Map();
  return Promise.all(passport.evidence.map(async (item, index) => {
    const recorded = recordedChecks[index];
    const latest = newestEligibleEvidenceCheck(checksByName.get(item.checkName) ?? [], item);
    const workflowPath = workflows.get(`${item.checkName}\0${item.expectedPublisher}`) ?? null;
    const workflowCurrent = !workflowPath || (
      await githubActionsWorkflowMatches({
        encodedRepository,
        repository: passport.target.repository,
        headSha: passport.target.headSha,
        check: recorded,
        workflowPath,
        token,
        runCache,
      })
      && await githubActionsWorkflowMatches({
        encodedRepository,
        repository: passport.target.repository,
        headSha: passport.target.headSha,
        check: latest,
        workflowPath,
        token,
        runCache,
      })
    );
    return {
      item,
      recorded,
      latest,
      current: evidenceCheckMatchesPassport(recorded, item)
        && evidenceCheckMatchesPassport(latest, item)
        && workflowCurrent,
    };
  }));
}

async function guardEvidenceChecks(encodedRepository, passport, token, requiredChecks) {
  let observations;
  try {
    observations = await evidenceFreshnessObservations(encodedRepository, passport, token, requiredChecks);
  } catch (error) {
    if (error instanceof HttpError || error instanceof GitHubError) throw error;
    throw new HttpError(409, "Guard evidence freshness could not be established safely.");
  }
  for (const observation of observations) {
    if (!observation.current) {
      throw new HttpError(409, "Guard evidence changed or does not match the exact-head passport.");
    }
  }
  return observations.map(({ recorded }) => recorded);
}

function assuranceProofEvidenceChecks(observations) {
  return observations.flatMap(({ recorded, latest, current }) => (
    current
      ? [recorded]
      : [recorded, latest]
  ));
}

async function guardCurrentTarget(encodedRepository, repo, source, token, refs = {}) {
  const target = source?.target ?? source;
  if (target.type === "pull_request") {
    const pull = await github(
      `/repos/${encodedRepository}/pulls/${target.pullRequestNumber}`,
      token,
    );
    let unique = true;
    if (refs.requireUnique === true) {
      const associated = await github(
        `/repos/${encodedRepository}/commits/${target.headSha}/pulls?per_page=100`,
        token,
      );
      if (!Array.isArray(associated) || associated.length >= 100) unique = false;
      else {
        const supported = associated.filter((candidate) => (
          candidate?.state === "open"
          && candidate?.head?.sha === target.headSha
          && candidate?.head?.repo?.full_name === repo.full_name
          && candidate?.base?.repo?.full_name === repo.full_name
        ));
        unique = supported.length === 1
          && supported[0]?.number === target.pullRequestNumber
          && supported[0]?.base?.sha === target.baseSha
          && supported[0]?.head?.ref === pull?.head?.ref
          && supported[0]?.base?.ref === pull?.base?.ref;
      }
    }
    return {
      type: "pull_request",
      repository: repo.full_name,
      repositoryId: repo.id,
      headRepositoryId: pull?.head?.repo?.id,
      baseRepositoryId: pull?.base?.repo?.id,
      pullRequestNumber: pull?.number,
      headRef: pull?.head?.ref,
      baseRef: pull?.base?.ref,
      headSha: pull?.head?.sha,
      baseSha: pull?.base?.sha,
      ...(refs.includeProofState === true ? {
        state: pull?.state,
        merged: pull?.merged === true,
        uniqueOpenPullRequest: unique,
      } : {}),
      current: pull?.state === "open"
        && pull?.merged !== true
        && pull?.head?.sha === target.headSha
        && pull?.base?.sha === target.baseSha
        && unique,
    };
  }
  const headRef = refs.headRef ?? target.headRef;
  const baseRef = refs.baseRef ?? target.baseRef;
  const refPath = typeof headRef === "string" && headRef.startsWith("refs/")
    ? headRef.slice("refs/".length)
    : null;
  const liveRef = refPath
    ? await github(`/repos/${encodedRepository}/git/ref/${encodeRef(refPath)}`, token)
    : null;
  return {
    type: "merge_group",
    repository: repo.full_name,
    repositoryId: repo.id,
    headRepositoryId: repo.id,
    baseRepositoryId: repo.id,
    pullRequestNumber: null,
    headRef,
    baseRef,
    headSha: liveRef?.object?.sha,
    baseSha: target.baseSha,
    current: liveRef?.object?.sha === target.headSha,
  };
}

async function listGuardChecks(encodedRepository, headSha, token) {
  const payload = await github(
    `/repos/${encodedRepository}/commits/${headSha}/check-runs?check_name=${encodeURIComponent(GUARD_CHECK_NAME)}&filter=all&per_page=100`,
    token,
  );
  if (!Array.isArray(payload?.check_runs) || payload.check_runs.length >= 100) {
    throw new HttpError(409, "The dedicated guard history is invalid or too large to order safely.");
  }
  return payload.check_runs;
}

function guardAppChecks(checks, configuration, headSha) {
  return checks.filter((check) => (
    check?.name === GUARD_CHECK_NAME
    && check?.head_sha === headSha
    && check?.app?.id === configuration.appId
    && check?.app?.slug === configuration.appSlug
  ));
}

function guardRunMarker(check) {
  try {
    return decodeGuardRunMarker(check?.output?.text);
  } catch {
    throw new HttpError(409, "The dedicated guard run marker is missing or malformed.");
  }
}

function assertGuardRunCanBegin(existing, incoming) {
  if (!existing) return "create";
  const current = guardRunMarker(existing);
  const order = compareGuardRunOrder(incoming, current);
  if (existing.status === "in_progress"
    && current.phase === "begin"
    && order === 0) {
    return "idempotent";
  }
  if (order > 0) return "replace";
  throw new HttpError(409, "This exact revision already has a newer or completed evaluation generation.");
}

function assertGuardRunCanComplete(existing, incoming) {
  if (!existing) throw new HttpError(409, "The App-owned guard was not invalidated before evaluation.");
  const current = guardRunMarker(existing);
  if (compareGuardRunOrder(incoming, current) !== 0) {
    throw new HttpError(409, "The guard completion does not own the current exact-revision evaluation lease.");
  }
  return current;
}

function guardPreviousContractDigest(check, request, configuration) {
  try {
    return guardBoundContractDigest(check, {
      repository: request.repository,
      repositoryId: request.repositoryId ?? request.passport?.target.repositoryId,
      target: request.target ?? request.passport?.target,
      appId: configuration.appId,
      appSlug: configuration.appSlug,
    });
  } catch {
    throw new HttpError(409, "The previous exact-head contract binding cannot be authenticated.");
  }
}

async function guardManagedBase(encodedRepository, defaultBranch, controllerSha, token) {
  const baseRef = await github(
    `/repos/${encodedRepository}/git/ref/heads/${encodeRef(defaultBranch)}`,
    token,
  );
  const workflowSha = baseRef?.object?.sha;
  if (!/^[a-f0-9]{40}$/u.test(workflowSha ?? "") || workflowSha !== controllerSha) {
    throw new HttpError(409, "The trusted default branch changed before guard publication.");
  }
  const [policyContent, manifestContent] = await Promise.all([
    readRepositoryFile(encodedRepository, POLICY_PATH, workflowSha, token),
    readRepositoryFile(encodedRepository, MANAGED_MANIFEST_PATH, workflowSha, token),
  ]);
  if (typeof policyContent !== "string" || typeof manifestContent !== "string") {
    throw new HttpError(409, "The trusted managed guard policy is missing.");
  }
  const managedProfile = await readCurrentManagedRuntimeProfile(
    encodedRepository,
    workflowSha,
    manifestContent,
    policyContent,
    token,
  );
  let trustedHarnessMode;
  try {
    trustedHarnessMode = harnessPolicy(JSON.parse(policyContent)?.harness).mode;
  } catch {
    throw new HttpError(409, "The trusted managed guard recovery policy is invalid.");
  }
  return { workflowSha, policyContent, trustedHarnessMode, managedProfile };
}

async function trustedGuardRecoveryState({ encodedRepository, repo, configuration, checkRun, trustedHarnessMode, token }) {
  const now = new Date().toISOString();
  const fallback = reconcileGuardState({ checkRun, trustedHarnessMode, now });
  if (trustedHarnessMode === HARNESS_MODE.AUTONOMOUS || fallback.state !== "within_window") return fallback;
  const earlyRecovery = reconcileGuardState({ checkRun, trustedHarnessMode, sourceRunCompleted: true, now });
  if (earlyRecovery.patch == null) return fallback;
  let sourceRunCompleted = false;
  if (checkRun?.name === GUARD_CHECK_NAME
    && checkRun?.app?.id === configuration.appId && checkRun?.app?.slug === configuration.appSlug) {
    const marker = guardRunMarker(checkRun);
    let run;
    try {
      run = await github(`/repos/${encodedRepository}/actions/runs/${marker.runId}/attempts/${marker.runAttempt}`, token);
    } catch {
      // Missing, inaccessible or unavailable owning-run evidence cannot shorten recovery.
      run = null;
    }
    sourceRunCompleted = String(run?.id ?? "") === String(marker.runId)
      && String(run?.run_attempt ?? "") === String(marker.runAttempt)
      && run?.repository?.id === repo.id && run?.repository?.full_name === repo.full_name
      && githubWorkflowFilePath(run?.path) === GUARD_WORKFLOW_PATH
      && run?.status === "completed"
      && ["action_required", "cancelled", "failure", "neutral", "skipped", "stale", "success", "timed_out", "startup_failure"].includes(run?.conclusion);
  }
  return sourceRunCompleted ? earlyRecovery : fallback;
}

const PILOT_DENIAL_REASONS = new Set([
  "not_enrolled", "contract_inactive", "contract_not_started", "contract_expired",
  "repository_limit", "unsupported_capability", "quota_exhausted", "workflow_outside_contract",
]);

function pilotAdmissionBlock(reason) {
  const unavailable = !PILOT_DENIAL_REASONS.has(reason);
  const message = unavailable
    ? "ChangePlane could not confirm the pilot allowance. The Guard is blocked. Re-run ChangePlane with a new workflow attempt after the service recovers."
    : reason === "quota_exhausted"
      ? "This organization's pilot evaluation allowance is used up. The Guard is blocked. Ask the organization owner to review the allowance, then re-run ChangePlane."
      : reason === "unsupported_capability"
        ? "This pilot supports Verify Lite pull requests. The Guard is blocked. Use the reviewed Verify Lite setup before re-running ChangePlane."
        : "This evaluation does not have an active pilot allowance. The Guard is blocked. Ask the organization owner to check pilot enrollment, then start a new workflow attempt.";
  return { status: unavailable ? 503 : 402, message,
    code: unavailable ? "PILOT_ADMISSION_UNAVAILABLE" : "PILOT_ADMISSION_DENIED" };
}

// Admission is commercial resource accounting, never evidence or Check authority.
// Its failures become explicit terminal Guard states, not exceptions after a
// known Check write. Only the enclosing journal can release publication ownership.
async function admitPilotEvaluation({ suppliedPilotAdmission, repo, installation, configuration,
  request, claims, managedProfile, trustedHarnessMode, encodedRepository, token }) {
  if (!pilotAdmissionRequested(suppliedPilotAdmission)) return null;
  if (managedProfile !== MANAGED_PROFILE.VERIFY_LITE
    || trustedHarnessMode !== HARNESS_MODE.VERIFY || request.target.type !== "pull_request") {
    return pilotAdmissionBlock("unsupported_capability");
  }
  if (!pilotAdmissionIsConfigured()
    || !Number.isSafeInteger(repo.owner?.id) || repo.owner.id <= 0
    || installation.account?.id !== repo.owner.id) return pilotAdmissionBlock("unavailable");
  try {
    const run = await github(`/repos/${encodedRepository}/actions/runs/${request.workflowRunId}/attempts/${request.workflowRunAttempt}`, token);
    const started = Date.parse(run?.run_started_at ?? "");
    if (String(run?.id) !== String(request.workflowRunId)
      || String(run?.run_attempt) !== String(request.workflowRunAttempt)
      || run?.repository?.id !== repo.id || run?.repository?.full_name !== repo.full_name
      || githubWorkflowFilePath(run?.path) !== GUARD_WORKFLOW_PATH
      || run?.event !== claims.eventName || !Number.isFinite(started)) return pilotAdmissionBlock("unavailable");
    let admission = suppliedPilotAdmission;
    if (!admission) {
      const connectionString = process.env.CHANGEPLANE_DATABASE_URL;
      if (pilotAdmissionCache?.connectionString !== connectionString) {
        const previous = pilotAdmissionCache;
        pilotAdmissionCache = { connectionString, admission: createPostgresPilotAdmission({ connectionString }) };
        previous?.admission.close().catch(() => {});
      }
      admission = pilotAdmissionCache.admission;
    }
    const result = await admission.admitEvaluation({
      tenantId: repo.owner.id, repositoryId: repo.id, installationId: installation.id,
      guardAppId: configuration.appId,
      revisionFingerprint: createHash("sha256")
        .update(`${repo.id}\0pull_request\0${request.target.pullRequestNumber}\0${request.target.headSha}`).digest("hex"),
      evaluationGeneration: `${request.workflowRunId}.${request.workflowRunAttempt}`,
      capability: "verify", targetType: "pull_request", workflowStartedAt: new Date(started).toISOString(),
    });
    if (result?.admitted === false) return pilotAdmissionBlock(result.reason);
    if (result?.admitted !== true || typeof result.duplicate !== "boolean"
      || result.reason !== (result.duplicate ? "already_admitted" : "admitted")
      || !/^[0-9]{4}-(?:0[1-9]|1[0-2])$/u.test(result.period ?? "")
      || !Number.isSafeInteger(result.evaluations) || result.evaluations < 1
      || !Number.isSafeInteger(result.included) || result.included < 1
      || !Number.isSafeInteger(result.graceRemaining) || result.graceRemaining < 0
      || !Number.isFinite(Date.parse(result.admittedAt))
      || new Date(result.admittedAt).toISOString() !== result.admittedAt) return pilotAdmissionBlock("unavailable");
    return null;
  } catch { return pilotAdmissionBlock("unavailable"); }
}

async function guardBegin({ body, oidcToken, configuration, repository, journalRuntime, suppliedPilotAdmission }) {
  const targetType = body?.target?.type;
  const expectedRef = body?.gitRef;
  if (targetType === "merge_group"
    && (typeof expectedRef !== "string"
      || !expectedRef.startsWith(`refs/heads/gh-readonly-queue/${body?.defaultBranch ?? ""}/`))) {
    throw new HttpError(403, "The merge-group workflow ref is invalid.");
  }
  let claims;
  try {
    claims = await verifyGitHubActionsOidcToken({
      token: oidcToken,
      audience: GUARD_PUBLISHER_AUDIENCE,
      repository,
      repositoryId: body?.repositoryId,
      defaultBranch: body?.defaultBranch,
      workflowPath: GUARD_WORKFLOW_PATH,
      workflowSha: body?.controllerSha,
      ref: expectedRef,
      allowedEventNames: targetType === "merge_group" ? ["merge_group"] : GUARD_PULL_REQUEST_EVENTS,
    });
  } catch {
    throw new HttpError(403, "GitHub OIDC guard invalidation authentication failed.");
  }

  const encodedRepository = encodeRepository(repository);
  const appJwt = createGitHubAppJwt({
    appId: configuration.appId,
    privateKey: configuration.privateKey,
  });
  const installation = await github(`/repos/${encodedRepository}/installation`, appJwt);
  if (!Number.isSafeInteger(installation?.id) || installation.id <= 0
    || installation.app_id !== configuration.appId
    || installation.app_slug !== configuration.appSlug) {
    throw new HttpError(403, "The repository is not bound to the configured ChangePlane App.");
  }
  const readCredential = await createGuardReadInstallationAccessToken({
    appId: configuration.appId,
    privateKey: configuration.privateKey,
    installationId: installation.id,
    repositoryId: body?.repositoryId,
    request: github,
  });
  const repo = await github(`/repos/${encodedRepository}`, readCredential.token);
  if (repo?.full_name !== repository || repo.id !== body?.repositoryId
    || repo.default_branch !== body?.defaultBranch) {
    throw new HttpError(409, "The live repository identity does not match the guard invalidation.");
  }
  return withGuardPublication(journalRuntime, {
    repo, installation, configuration, headSha: body?.target?.headSha, operation: "begin",
  }, async ({ write }) => {
    const { workflowSha, managedProfile, trustedHarnessMode } = await guardManagedBase(
      encodedRepository,
      repo.default_branch,
      body?.controllerSha,
      readCredential.token,
    );
    const currentTarget = await guardCurrentTarget(
      encodedRepository,
      repo,
      body?.target,
      readCredential.token,
      { baseRef: body?.target?.baseRef, headRef: body?.target?.headRef, requireUnique: true },
    );
    let request;
    try {
      request = validateGuardBeginBody(body, {
        oidcClaims: claims,
        expectedWorkflowSha: workflowSha,
        currentTarget,
      });
    } catch {
      throw new HttpError(409, "The guard invalidation request is stale or outside the trusted workflow boundary.");
    }

    const finalBaseRef = await github(
      `/repos/${encodedRepository}/git/ref/heads/${encodeRef(repo.default_branch)}`,
      readCredential.token,
    );
    const finalTarget = await guardCurrentTarget(
      encodedRepository,
      repo,
      body.target,
      readCredential.token,
      { baseRef: body.target.baseRef, headRef: body.target.headRef, requireUnique: true },
    );
    if (finalBaseRef?.object?.sha !== workflowSha || finalTarget.current !== true
      || finalTarget.headSha !== currentTarget.headSha || finalTarget.baseSha !== currentTarget.baseSha
      || finalTarget.headRef !== currentTarget.headRef || finalTarget.baseRef !== currentTarget.baseRef) {
      throw new HttpError(409, "The GitHub target changed before guard invalidation.");
    }

    const allChecks = await listGuardChecks(encodedRepository, request.target.headSha, readCredential.token);
    const appChecks = guardAppChecks(allChecks, configuration, request.target.headSha);
    const stable = appChecks.filter((check) => check?.external_id === request.check.external_id);
    if (stable.length > 1) throw new HttpError(409, "The dedicated guard publication is ambiguous.");
    const incomingMarker = decodeGuardRunMarker(request.check.output.text);
    const beginState = assertGuardRunCanBegin(stable[0], incomingMarker);
    const previousContractDigest = guardPreviousContractDigest(stable[0], request, configuration);
    const beginCheck = {
      ...request.check,
      output: {
        ...request.check.output,
        text: encodeGuardRunMarker({
          ...incomingMarker,
          boundContractDigest: previousContractDigest,
          pullRequestNumber: request.target.pullRequestNumber,
        }),
      },
    };
    let published = stable[0];
    const stableMarker = published ? guardRunMarker(published) : null;
    const idempotent = beginState === "idempotent"
      && published?.status === "in_progress"
      && stableMarker?.phase === "begin"
      && compareGuardRunOrder(incomingMarker, stableMarker) === 0
      && published.output?.text === beginCheck.output.text;
    let writeCredential;
    if (!idempotent) {
      writeCredential = await createChecksWriteInstallationAccessToken({
        appId: configuration.appId,
        privateKey: configuration.privateKey,
        installationId: installation.id,
        repositoryId: repo.id,
        request: github,
      });
      for (const legacy of appChecks.filter((check) => (
        check?.external_id !== request.check.external_id
        && check?.status === "completed"
        && ["success", "neutral", "skipped"].includes(check?.conclusion)
      ))) {
        const retired = await write(() => github(`/repos/${encodedRepository}/check-runs/${legacy.id}`, writeCredential.token, {
          method: "PATCH",
          body: {
            status: "completed",
            conclusion: "action_required",
            output: {
              title: "Superseded by a new evaluation",
              summary: "A new trusted ChangePlane run started for this exact revision. This older result no longer applies.",
            },
          },
        }));
        if (retired?.id !== legacy.id || retired?.name !== GUARD_CHECK_NAME
          || retired?.head_sha !== request.target.headSha || retired?.status !== "completed"
          || retired?.conclusion !== "action_required"
          || retired?.app?.id !== configuration.appId || retired?.app?.slug !== configuration.appSlug) {
          throw new HttpError(502, "GitHub did not confirm that the previous Guard was invalidated.");
        }
      }
      const mutationChecks = guardAppChecks(
        await listGuardChecks(encodedRepository, request.target.headSha, readCredential.token),
        configuration,
        request.target.headSha,
      ).filter((check) => check?.external_id === request.check.external_id);
      if (mutationChecks.length !== stable.length || mutationChecks[0]?.id !== stable[0]?.id
        || mutationChecks[0]?.status !== stable[0]?.status
        || mutationChecks[0]?.conclusion !== stable[0]?.conclusion
        || mutationChecks[0]?.output?.text !== stable[0]?.output?.text
        || mutationChecks[0]?.output?.summary !== stable[0]?.output?.summary) {
        throw new HttpError(409, "The dedicated guard generation changed before invalidation.");
      }
      published = published
        ? await write(() => github(`/repos/${encodedRepository}/check-runs/${published.id}`, writeCredential.token, {
          method: "PATCH",
          body: Object.fromEntries(Object.entries(beginCheck).filter(([key]) => key !== "head_sha")),
        }))
        : await write(() => github(`/repos/${encodedRepository}/check-runs`, writeCredential.token, {
          method: "POST",
          body: beginCheck,
        }));
    }
    if (!Number.isSafeInteger(published?.id) || published.id <= 0
      || published.name !== GUARD_CHECK_NAME || published.head_sha !== request.target.headSha
      || published.status !== "in_progress" || published.external_id !== request.check.external_id
      || published.output?.text !== beginCheck.output.text
      || published.app?.id !== configuration.appId || published.app?.slug !== configuration.appSlug) {
      throw new HttpError(502, "GitHub did not return the expected in-progress dedicated-App guard.");
    }
    // The previous usable success is gone before any commercial network/DB wait.
    // A process loss here leaves an occupied lane AND an in-progress Guard.
    const admissionBlock = await admitPilotEvaluation({ suppliedPilotAdmission, repo, installation,
      configuration, request, claims, managedProfile, trustedHarnessMode, encodedRepository, token: readCredential.token });
    if (admissionBlock) {
      writeCredential ??= await createChecksWriteInstallationAccessToken({
        appId: configuration.appId, privateKey: configuration.privateKey,
        installationId: installation.id, repositoryId: repo.id, request: github,
      });
      const text = encodeGuardRunMarker({ ...decodeGuardRunMarker(beginCheck.output.text), phase: "complete" });
      const blocked = await write(() => github(`/repos/${encodedRepository}/check-runs/${published.id}`, writeCredential.token, {
        method: "PATCH", body: { status: "completed", conclusion: "action_required",
          output: { title: admissionBlock.code === "PILOT_ADMISSION_DENIED" ? "Pilot allowance needs attention" : "Pilot allowance could not be confirmed",
            summary: admissionBlock.message, text } },
      }));
      if (blocked?.id !== published.id || blocked?.name !== GUARD_CHECK_NAME
        || blocked?.head_sha !== request.target.headSha || blocked?.external_id !== request.check.external_id
        || blocked?.status !== "completed" || blocked?.conclusion !== "action_required"
        || blocked?.output?.text !== text || blocked?.output?.summary !== admissionBlock.message
        || blocked?.app?.id !== configuration.appId || blocked?.app?.slug !== configuration.appSlug) {
        throw new HttpError(502, "GitHub did not confirm the blocked pilot Guard.");
      }
      return { admissionBlock };
    }
    return {
      schemaVersion: 1,
      type: "changeplane.guard-publication-begin",
      check: {
        id: published.id,
        name: published.name,
        headSha: published.head_sha,
        status: published.status,
        publisherAppId: published.app.id,
        publisherAppSlug: published.app.slug,
      },
      run: { id: request.workflowRunId, attempt: request.workflowRunAttempt },
      previousContractDigest,
    };
  });
}

async function guardReconciliationSweep({ body, oidcToken, configuration, repository, journalRuntime }) {
  let claims;
  try {
    claims = await verifyGitHubActionsOidcToken({
      token: oidcToken,
      audience: GUARD_PUBLISHER_AUDIENCE,
      repository,
      repositoryId: body?.repositoryId,
      defaultBranch: body?.defaultBranch,
      workflowPath: GUARD_WORKFLOW_PATH,
      workflowSha: body?.controllerSha,
      ref: body?.gitRef,
      allowedEventNames: ["schedule", "workflow_dispatch"],
    });
  } catch {
    throw new HttpError(403, "GitHub OIDC guard reconciliation authentication failed.");
  }

  const encodedRepository = encodeRepository(repository);
  const appJwt = createGitHubAppJwt({
    appId: configuration.appId,
    privateKey: configuration.privateKey,
  });
  const installation = await github(`/repos/${encodedRepository}/installation`, appJwt);
  if (!Number.isSafeInteger(installation?.id) || installation.id <= 0
    || installation.app_id !== configuration.appId
    || installation.app_slug !== configuration.appSlug) {
    throw new HttpError(403, "The repository is not bound to the configured ChangePlane App.");
  }
  const readCredential = await createGuardReadInstallationAccessToken({
    appId: configuration.appId,
    privateKey: configuration.privateKey,
    installationId: installation.id,
    repositoryId: body?.repositoryId,
    request: github,
  });
  const repo = await github(`/repos/${encodedRepository}`, readCredential.token);
  if (repo?.full_name !== repository || repo.id !== body?.repositoryId
    || repo.default_branch !== body?.defaultBranch) {
    throw new HttpError(409, "The live repository identity does not match the reconciliation request.");
  }
  const { workflowSha, trustedHarnessMode } = await guardManagedBase(
    encodedRepository,
    repo.default_branch,
    body?.controllerSha,
    readCredential.token,
  );
  let request;
  try {
    request = validateGuardReconciliationBody(body, {
      oidcClaims: claims,
      expectedWorkflowSha: workflowSha,
    });
  } catch {
    throw new HttpError(409, "The guard reconciliation request is stale or outside the trusted workflow boundary.");
  }

  const pulls = await github(
    `/repos/${encodedRepository}/pulls?state=open&sort=updated&direction=desc&per_page=50`,
    readCredential.token,
  );
  if (!Array.isArray(pulls) || pulls.length >= 50) {
    throw new HttpError(409, "The open pull-request inventory is invalid or exceeds the bounded reconciliation sweep.");
  }
  const seenHeads = new Set();
  const inventory = [];
  for (const pull of pulls) {
    if (pull?.state !== "open" || pull?.merged === true
      || pull?.head?.repo?.id !== repo.id || pull?.head?.repo?.full_name !== repository
      || pull?.base?.repo?.id !== repo.id || pull?.base?.repo?.full_name !== repository
      || pull?.base?.ref !== repo.default_branch
      || !Number.isSafeInteger(pull?.number) || pull.number <= 0
      || !/^[a-f0-9]{40}$/u.test(pull?.head?.sha ?? "")) continue;
    if (seenHeads.has(pull.head.sha)) {
      throw new HttpError(409, "One exact head belongs to multiple open pull requests; reconciliation stopped without mutation.");
    }
    seenHeads.add(pull.head.sha);
    inventory.push(pull);
  }

  let inProgress = 0;
  let reconciled = 0;
  for (const discovered of inventory) {
    const headSha = discovered.head.sha;
    const result = await withGuardPublication(journalRuntime, {
      repo, installation, configuration, headSha, operation: "reconcile",
    }, async ({ write }) => {
      // Inventory selects immutable head lanes only. Policy, target, publisher,
      // generation and owning-run evidence are freshly read while holding one.
      const trusted = await guardManagedBase(encodedRepository, repo.default_branch, workflowSha, readCredential.token);
      const target = {
        type: "pull_request", pullRequestNumber: discovered.number,
        headSha, baseSha: discovered.base.sha,
        headRef: discovered.head.ref, baseRef: discovered.base.ref,
      };
      const readTarget = () => guardCurrentTarget(encodedRepository, repo, target, readCredential.token, { requireUnique: journalRuntime !== null });
      const current = await readTarget();
      if (!current.current || current.headRepositoryId !== repo.id || current.baseRepositoryId !== repo.id
        || current.baseRef !== repo.default_branch) {
        throw new HttpError(409, "A Guard recovery target changed. Inspect the current revision before retrying the sweep.");
      }
      const expectedExternalId = stableGuardCheckExternalId({ repositoryId: repo.id, targetType: "pull_request", headSha });
      const stable = guardAppChecks(await listGuardChecks(encodedRepository, headSha, readCredential.token), configuration, headSha)
        .filter((check) => check?.external_id === expectedExternalId);
      if (stable.length > 1) throw new HttpError(409, "The dedicated Guard recovery target is ambiguous.");
      const check = stable[0];
      if (check?.status !== "in_progress") return { inProgress: 0, reconciled: 0 };
      const context = { encodedRepository, repo, configuration, trustedHarnessMode: trusted.trustedHarnessMode, token: readCredential.token };
      const recovery = await trustedGuardRecoveryState({ ...context, checkRun: check });
      if (recovery.patch === null) return { inProgress: 1, reconciled: 0 };

      const [finalTarget, finalBase, finalCheck] = await Promise.all([
        readTarget(),
        github(`/repos/${encodedRepository}/git/ref/heads/${encodeRef(request.defaultBranch)}`, readCredential.token),
        github(`/repos/${encodedRepository}/check-runs/${check.id}`, readCredential.token),
      ]);
      if (!finalTarget.current || finalTarget.headRepositoryId !== repo.id || finalTarget.baseRepositoryId !== repo.id
        || finalBase?.object?.sha !== workflowSha || finalCheck?.id !== check.id
        || finalCheck?.name !== GUARD_CHECK_NAME || finalCheck?.head_sha !== headSha
        || finalCheck?.external_id !== expectedExternalId
        || finalCheck?.app?.id !== configuration.appId || finalCheck?.app?.slug !== configuration.appSlug) {
        throw new HttpError(409, "A Guard recovery target changed before mutation. Inspect its current revision.");
      }
      const finalRecovery = await trustedGuardRecoveryState({ ...context, checkRun: finalCheck });
      if (finalRecovery.state !== "reconcile_required" || finalRecovery.generation !== recovery.generation) {
        throw new HttpError(409, "The owning Guard generation changed before reconciliation.");
      }
      const writeCredential = await createChecksWriteInstallationAccessToken({
        appId: configuration.appId, privateKey: configuration.privateKey,
        installationId: installation.id, repositoryId: repo.id, request: github,
      });
      const published = await write(() => github(`/repos/${encodedRepository}/check-runs/${check.id}`, writeCredential.token, {
        method: "PATCH", body: finalRecovery.patch,
      }));
      if (published?.id !== check.id || published?.name !== GUARD_CHECK_NAME
        || published?.head_sha !== headSha || published?.status !== "completed"
        || published?.conclusion !== "action_required" || published?.external_id !== expectedExternalId
        || published?.output?.text !== finalRecovery.patch.output.text
        || published?.app?.id !== configuration.appId || published?.app?.slug !== configuration.appSlug) {
        throw new HttpError(502, "GitHub did not return the safely reconciled Guard Check.");
      }
      return { inProgress: 1, reconciled: 1 };
    });
    inProgress += result.inProgress;
    reconciled += result.reconciled;
  }
  return {
    schemaVersion: 1,
    type: "changeplane.guard-reconciliation-sweep",
    scannedHeads: seenHeads.size,
    inProgress,
    reconciled,
    withinWindow: inProgress - reconciled,
  };
}

async function guardPublish(req, res, suppliedJournal, suppliedPilotAdmission) {
  const journalRuntime = guardJournalRuntime(suppliedJournal);
  const configuration = guardPublisherConfiguration();
  const oidcToken = guardPublisherBearer(req);
  assertJsonRequest(req);
  const body = await readJson(req, { maxBytes: 96 * 1_024 });
  let repository;
  try {
    repository = validateRepository(body?.repository);
  } catch {
    throw new HttpError(400, "The guard publication repository is malformed.");
  }
  assertGuardPublisherRolloutScope(repository);
  if (body?.type === "changeplane.guard-publication-begin") {
    const result = await guardBegin({ body, oidcToken, configuration, repository, journalRuntime, suppliedPilotAdmission });
    // HTTP denial occurs only after the journal has durably released the fully
    // acknowledged action_required result. It cannot poison a known safe write.
    if (result.admissionBlock) throw new PilotAdmissionBlock(result.admissionBlock);
    sendJson(res, 200, result);
    return;
  }
  if (body?.type === "changeplane.guard-reconciliation-sweep") {
    const result = await guardReconciliationSweep({ body, oidcToken, configuration, repository, journalRuntime });
    sendJson(res, 200, result);
    return;
  }
  let passport;
  try {
    passport = verifyAssurancePassportIntegrity(body?.passport);
    if (passport.target.repository !== repository || passport.binding.policyPath !== POLICY_PATH) {
      throw new Error("Guard repository or policy path mismatch.");
    }
  } catch {
    throw new HttpError(400, "The guard publication request is malformed.");
  }

  const expectedRef = body?.gitRef;
  if (passport.target.type === "merge_group"
    && (typeof expectedRef !== "string"
      || !expectedRef.startsWith(`refs/heads/gh-readonly-queue/${body?.defaultBranch ?? ""}/`))) {
    throw new HttpError(403, "The merge-group workflow ref is invalid.");
  }
  let claims;
  try {
    claims = await verifyGitHubActionsOidcToken({
      token: oidcToken,
      audience: GUARD_PUBLISHER_AUDIENCE,
      repository,
      repositoryId: passport.target.repositoryId,
      defaultBranch: body?.defaultBranch,
      workflowPath: GUARD_WORKFLOW_PATH,
      workflowSha: passport.target.baseSha,
      ref: expectedRef,
      allowedEventNames: passport.target.type === "merge_group"
        ? ["merge_group"]
        : GUARD_PULL_REQUEST_EVENTS,
    });
  } catch {
    throw new HttpError(403, "GitHub OIDC guard publication authentication failed.");
  }

  const encodedRepository = encodeRepository(repository);
  const appJwt = createGitHubAppJwt({
    appId: configuration.appId,
    privateKey: configuration.privateKey,
  });
  const installation = await github(`/repos/${encodedRepository}/installation`, appJwt);
  if (!Number.isSafeInteger(installation?.id) || installation.id <= 0
    || installation.app_id !== configuration.appId
    || installation.app_slug !== configuration.appSlug) {
    throw new HttpError(403, "The repository is not bound to the configured ChangePlane App.");
  }
  const readCredential = await createGuardReadInstallationAccessToken({
    appId: configuration.appId,
    privateKey: configuration.privateKey,
    installationId: installation.id,
    repositoryId: passport.target.repositoryId,
    request: github,
  });
  const repo = await github(`/repos/${encodedRepository}`, readCredential.token);
  if (repo?.full_name !== repository || repo.id !== passport.target.repositoryId
    || repo.default_branch !== body.defaultBranch) {
    throw new HttpError(409, "The live repository identity does not match the guard request.");
  }
  const result = await withGuardPublication(journalRuntime, {
    repo, installation, configuration, headSha: passport.target.headSha, operation: "complete",
  }, async ({ write }) => {
    const baseRef = await github(
      `/repos/${encodedRepository}/git/ref/heads/${encodeRef(repo.default_branch)}`,
      readCredential.token,
    );
    const workflowSha = baseRef?.object?.sha;
    if (!/^[a-f0-9]{40}$/u.test(workflowSha ?? "") || workflowSha !== passport.target.baseSha) {
      throw new HttpError(409, "The trusted default branch changed before guard publication.");
    }
    const [policyContent, manifestContent] = await Promise.all([
      readRepositoryFile(encodedRepository, passport.binding.policyPath, workflowSha, readCredential.token),
      readRepositoryFile(encodedRepository, MANAGED_MANIFEST_PATH, workflowSha, readCredential.token),
    ]);
    if (typeof policyContent !== "string" || typeof manifestContent !== "string") {
      throw new HttpError(409, "The trusted managed guard policy is missing.");
    }
    await readCurrentManagedRuntimeProfile(
      encodedRepository,
      workflowSha,
      manifestContent,
      policyContent,
      readCredential.token,
    );
    let policy;
    let requiredChecks;
    try {
      policy = JSON.parse(policyContent);
      requiredChecks = validateRequiredChecks(policy?.evidence?.requiredChecks, {
        mode: passport.decision.mode === "observe" ? "observe" : "enforce",
      });
    } catch {
      throw new HttpError(409, "The trusted guard policy is malformed.");
    }
    if (canonicalDigest(policy) !== passport.binding.policyDigest
      || !guardPolicyEvidenceMatches(passport, requiredChecks)) {
      throw new HttpError(409, "The guard passport does not match the trusted policy evidence contract.");
    }
    const currentTarget = await guardCurrentTarget(encodedRepository, repo, passport, readCredential.token, {
      baseRef: `refs/heads/${repo.default_branch}`,
      headRef: body.gitRef,
      requireUnique: true,
    });
    let request;
    try {
      request = validateGuardPublishBody(body, {
        oidcClaims: claims,
        expectedWorkflowSha: workflowSha,
        expectedControllerSha: passport.binding.trustedControllerSha,
        currentTarget,
      });
    } catch {
      throw new HttpError(409, "The guard publication request is stale or outside the trusted workflow boundary.");
    }

    const finalBaseRef = await github(
      `/repos/${encodedRepository}/git/ref/heads/${encodeRef(repo.default_branch)}`,
      readCredential.token,
    );
    if (finalBaseRef?.object?.sha !== workflowSha) {
      throw new HttpError(409, "The trusted default branch changed before guard mutation.");
    }
    const finalTarget = await guardCurrentTarget(encodedRepository, repo, passport, readCredential.token, {
      baseRef: `refs/heads/${repo.default_branch}`,
      headRef: body.gitRef,
      requireUnique: true,
    });
    if (finalTarget.current !== true
      || finalTarget.headSha !== currentTarget.headSha
      || finalTarget.baseSha !== currentTarget.baseSha) {
      throw new HttpError(409, "The GitHub target changed before guard mutation.");
    }

    const allChecks = await listGuardChecks(encodedRepository, passport.target.headSha, readCredential.token);
    const existing = guardAppChecks(allChecks, configuration, passport.target.headSha)
      .filter((check) => check?.external_id === request.check.external_id);
    if (existing.length > 1) throw new HttpError(409, "The dedicated guard publication is ambiguous.");
    const incomingMarker = decodeGuardRunMarker(request.check.output.text);
    const currentMarker = assertGuardRunCanComplete(existing[0], incomingMarker);
    const previousContractDigest = guardPreviousContractDigest(existing[0], request, configuration);
    if (previousContractDigest !== null && previousContractDigest !== passport.binding.contractDigest) {
      throw new HttpError(409, "The guard passport changed the frozen exact-head contract binding.");
    }
    await guardEvidenceChecks(encodedRepository, passport, readCredential.token, requiredChecks);
    let published = existing[0];
    const idempotent = currentMarker.phase === "complete"
      && published?.status === "completed"
      && published?.conclusion === request.check.conclusion
      && published?.output?.summary === request.check.output.summary
      && published?.output?.text === request.check.output.text;
    if (currentMarker.phase === "complete" && !idempotent) {
      throw new HttpError(409, "The current run already completed with a different assurance passport.");
    }
    if (!idempotent) {
      const writeCredential = await createChecksWriteInstallationAccessToken({
        appId: configuration.appId,
        privateKey: configuration.privateKey,
        installationId: installation.id,
        repositoryId: repo.id,
        request: github,
      });
      const mutationBase = await github(
        `/repos/${encodedRepository}/git/ref/heads/${encodeRef(repo.default_branch)}`,
        readCredential.token,
      );
      const mutationTarget = await guardCurrentTarget(encodedRepository, repo, passport, readCredential.token, {
        baseRef: `refs/heads/${repo.default_branch}`,
        headRef: body.gitRef,
        requireUnique: true,
      });
      if (mutationBase?.object?.sha !== workflowSha || mutationTarget.current !== true
        || mutationTarget.headSha !== currentTarget.headSha || mutationTarget.baseSha !== currentTarget.baseSha) {
        throw new HttpError(409, "The GitHub target changed while guard evidence was being verified.");
      }
      // Evidence and credential calls can outlive this generation. Re-read after
      // both, immediately before writing. This is a freshness check, not a CAS:
      // GitHub Checks does not provide a documented conditional PATCH contract.
      const mutationChecks = guardAppChecks(
        await listGuardChecks(encodedRepository, passport.target.headSha, readCredential.token),
        configuration,
        passport.target.headSha,
      ).filter((check) => check?.external_id === request.check.external_id);
      if (mutationChecks.length !== 1 || mutationChecks[0].id !== existing[0].id) {
        throw new HttpError(409, "The dedicated guard publication changed before completion.");
      }
      assertGuardRunCanComplete(mutationChecks[0], incomingMarker);
      if (mutationChecks[0].status !== existing[0].status
        || mutationChecks[0].conclusion !== existing[0].conclusion
        || mutationChecks[0].output?.text !== existing[0].output?.text
        || mutationChecks[0].output?.summary !== existing[0].output?.summary) {
        throw new HttpError(409, "The dedicated guard generation changed before completion.");
      }
      published = await write(() => github(`/repos/${encodedRepository}/check-runs/${existing[0].id}`, writeCredential.token, {
        method: "PATCH",
        body: Object.fromEntries(Object.entries(request.check).filter(([key]) => key !== "head_sha")),
      }));
    }
    if (!Number.isSafeInteger(published?.id) || published.id <= 0
      || published.name !== GUARD_CHECK_NAME
      || published.head_sha !== passport.target.headSha
      || published.status !== "completed"
      || published.conclusion !== request.check.conclusion
      || published.external_id !== request.check.external_id
      || published.output?.text !== request.check.output.text
      || published.app?.id !== configuration.appId
      || published.app?.slug !== configuration.appSlug) {
      throw new HttpError(502, "GitHub did not return the expected dedicated-App guard.");
    }
    const proofLocator = buildProofLocator(passport, published);
    return {
      schemaVersion: 1,
      type: "changeplane.guard-publication",
      passportDigest: passport.digest,
      check: {
        id: published.id,
        name: published.name,
        headSha: published.head_sha,
        conclusion: published.conclusion,
        publisherAppId: published.app.id,
        publisherAppSlug: published.app.slug,
      },
      proofLocator,
    };
  });
  sendJson(res, 200, result);
}

function unavailableAssuranceProof(error, facts = {}) {
  return {
    ...verifyAssuranceProof({
      integrityVerified: null,
      repositoryIdentityVerified: null,
      guardCheck: null,
      evidenceChecks: null,
      policyDigest: null,
      currentTarget: null,
      ...facts,
    }),
    failure: {
      code: "GITHUB_EVIDENCE_UNAVAILABLE",
      ...(error instanceof GitHubError ? {
        githubStatus: error.status,
        githubRequestId: error.requestId,
      } : {}),
    },
  };
}

async function assuranceProofStatus(req, res) {
  const session = requireSession(req);
  const repository = validateRepository(queryValue(req, "repository"));
  const checkRunId = proofCheckRunId(queryValue(req, "checkRunId"));
  const locatorDigest = proofPassportDigest(queryValue(req, "passportDigest"));
  const expectedGuardPublisher = configuredGuardPublisher();
  const { encodedRepository, repo } = await requireWritableRepository(repository, session);
  let guardCheck;
  try {
    guardCheck = await github(`/repos/${encodedRepository}/check-runs/${checkRunId}`, session.token);
  } catch (error) {
    if (error instanceof GitHubError || error instanceof TypeError) {
      sendJson(res, 503, unavailableAssuranceProof(error, {
        locatorDigest,
        expectedGuardPublisher,
      }));
      return;
    }
    throw error;
  }

  let passport;
  let integrityVerified = false;
  let guardMarkerVerified = false;
  try {
    passport = parseAssurancePassportIntegrity(String(guardCheck?.output?.summary ?? ""));
    if (!passport) throw new Error("The guard has no assurance passport.");
    integrityVerified = true;
    if (expectedGuardPublisher) {
      verifyAssurancePassportAgainstCheck(passport, guardCheck, {
        appId: expectedGuardPublisher.appId,
        appSlug: expectedGuardPublisher.appSlug,
      });
      if (guardCheck?.external_id !== stableGuardCheckExternalId({
        repositoryId: passport.target.repositoryId,
        targetType: passport.target.type,
        headSha: passport.target.headSha,
      }) || decodeGuardRunMarker(guardCheck?.output?.text).phase !== "complete") {
        throw new Error("The guard does not carry a completed ordered-run marker.");
      }
    }
    guardMarkerVerified = true;
  } catch {
    const proof = verifyAssuranceProof({
      passport,
      locatorDigest,
      integrityVerified,
      repositoryIdentityVerified: passport
        ? passport.target?.repository?.toLowerCase() === repo.full_name?.toLowerCase()
          && passport.target?.repositoryId === repo.id
        : false,
      guardMarkerVerified,
      guardCheck,
      expectedGuardPublisher,
      evidenceChecks: null,
      policyDigest: null,
      policyRequiredChecks: null,
      currentTarget: null,
    });
    sendJson(res, 200, proof);
    return;
  }

  const repositoryIdentityVerified = passport.target.repository.toLowerCase() === repo.full_name.toLowerCase()
    && passport.target.repositoryId === repo.id;
  let policyDigest = null;
  let policyRequiredChecks = null;
  let evidenceChecks = null;
  let currentTarget = null;
  try {
    const policyContent = await readRepositoryFile(
      encodedRepository,
      passport.binding.policyPath,
      passport.binding.policySourceRevision,
      session.token,
    );
    if (typeof policyContent === "string") {
      try {
        const policy = JSON.parse(policyContent);
        policyDigest = canonicalDigest(policy);
        try {
          policyRequiredChecks = validateRequiredChecks(policy?.evidence?.requiredChecks, {
            mode: passport.decision.mode === "observe" ? "observe" : "enforce",
          });
        } catch {
          policyRequiredChecks = "INVALID_POLICY_EVIDENCE";
        }
      } catch {
        policyDigest = "INVALID_POLICY_JSON";
        policyRequiredChecks = "INVALID_POLICY_EVIDENCE";
      }
    } else {
      policyDigest = "MISSING_TRUSTED_POLICY";
      policyRequiredChecks = "MISSING_POLICY_EVIDENCE";
    }

    if (passport.target.type === "pull_request") {
      currentTarget = await guardCurrentTarget(
        encodedRepository,
        repo,
        passport,
        session.token,
        { requireUnique: true, includeProofState: true },
      );
    }

    const evidenceObservations = await evidenceFreshnessObservations(
      encodedRepository,
      passport,
      session.token,
      Array.isArray(policyRequiredChecks) ? policyRequiredChecks : [],
    );
    evidenceChecks = assuranceProofEvidenceChecks(evidenceObservations);
  } catch (error) {
    if (error instanceof GitHubError || error instanceof TypeError) {
      sendJson(res, 503, unavailableAssuranceProof(error, {
        passport,
        locatorDigest,
        integrityVerified,
        repositoryIdentityVerified,
        guardMarkerVerified,
        guardCheck,
        expectedGuardPublisher,
        evidenceChecks,
        policyDigest,
        policyRequiredChecks,
        currentTarget,
      }));
      return;
    }
    throw error;
  }

  const proof = verifyAssuranceProof({
    passport,
    locatorDigest,
    integrityVerified,
    repositoryIdentityVerified,
    guardMarkerVerified,
    guardCheck,
    expectedGuardPublisher,
    evidenceChecks,
    policyDigest,
    policyRequiredChecks,
    currentTarget,
  });
  sendJson(res, proof.verdict === "INDETERMINATE" ? 503 : 200, proof);
}

async function configureRuntime(req, res) {
  assertOrigin(req);
  const session = requireSession(req);
  assertCsrf(req, session);
  assertJsonRequest(req);
  const body = await readJson(req);
  if (Object.hasOwn(body, "model")) validateRuntimeModel(body.model);
  if (Object.hasOwn(body, "harnessMode")) harnessPolicy({ mode: body.harnessMode });
  const repository = validateRepository(body.repository);
  const result = await createRuntimePullRequest(repository, session, body.model, body.harnessMode);
  sendJson(res, result.state === "current" ? 200 : 201, result);
}

async function repositoryActionsPublicKey(encodedRepository, token) {
  const publicKey = await github(`/repos/${encodedRepository}/actions/secrets/public-key`, token);
  if (typeof publicKey?.key_id !== "string" || !publicKey.key_id
    || typeof publicKey?.key !== "string" || !publicKey.key) {
    throw new HttpError(502, "GitHub returned an invalid repository encryption key.");
  }
  return publicKey;
}

async function putRepositoryActionsSecret(encodedRepository, token, publicKey, name, value) {
  if (!/^[A-Z0-9_]{1,100}$/u.test(name) || typeof value !== "string" || value.length === 0) {
    throw new TypeError("Repository secret input is invalid.");
  }
  await sodium.ready;
  let publicKeyBytes;
  let secretBytes;
  let encryptedBytes;
  try {
    publicKeyBytes = sodium.from_base64(publicKey.key, sodium.base64_variants.ORIGINAL);
    if (publicKeyBytes.length !== sodium.crypto_box_PUBLICKEYBYTES) {
      throw new HttpError(502, "GitHub returned an invalid repository encryption key.");
    }
    secretBytes = sodium.from_string(value);
    encryptedBytes = sodium.crypto_box_seal(secretBytes, publicKeyBytes);
    await github(`/repos/${encodedRepository}/actions/secrets/${name}`, token, {
      method: "PUT",
      body: {
        encrypted_value: sodium.to_base64(encryptedBytes, sodium.base64_variants.ORIGINAL),
        key_id: publicKey.key_id,
      },
      expectJson: false,
    });
  } finally {
    if (publicKeyBytes) sodium.memzero(publicKeyBytes);
    if (secretBytes) sodium.memzero(secretBytes);
    if (encryptedBytes) sodium.memzero(encryptedBytes);
  }
}

async function configureByok(req, res) {
  assertOrigin(req);
  const session = requireSession(req);
  assertCsrf(req, session);
  assertJsonRequest(req);
  const body = await readJson(req);
  const repository = validateRepository(body.repository);
  const apiKey = validateByokKey(body.apiKey);
  let target = await requireRepositoryAdmin(repository, session);
  const { encodedRepository, installationId } = target;
  if (!await installationCanWriteSecrets(session, installationId)) {
    throw new HttpError(403, "The GitHub App installation needs Actions Secrets write permission before BYOK can be configured. No provider request was made.");
  }
  const runtime = await readRepositoryRuntime(encodedRepository, target.repo, session.token);
  if (!runtime.content) {
    throw new HttpError(409, "Merge the ChangePlane setup pull request before adding a provider key.");
  }
  await verifyOpenAIKey(apiKey, { model: runtime.model });
  target = await revalidateRepositoryAdmin(target, repository, session);
  const byokToken = await repositoryByokToken(session, target.repo, installationId);
  const publicKey = await repositoryActionsPublicKey(encodedRepository, byokToken);
  await requireMatchingManagedRuntime(encodedRepository, target.repo, session.token, runtime);
  await putRepositoryActionsSecret(encodedRepository, byokToken, publicKey, BYOK_SECRET_NAME, apiKey);

  const byok = await readByokStatus(repository, byokToken);
  sendJson(res, 200, {
    repository,
    provider: RUNTIME_PROVIDER,
    model: runtime.model,
    activeModel: runtime.model,
    effort: PROPOSAL_REASONING_EFFORT,
    byok,
  });
}

async function disconnectByok(req, res) {
  assertOrigin(req);
  const session = requireSession(req);
  assertCsrf(req, session);
  assertJsonRequest(req);
  const body = await readJson(req);
  const repository = validateRepository(body.repository);
  const { encodedRepository, repo, installationId } = await requireRepositoryAdmin(repository, session);
  if (!await installationCanWriteSecrets(session, installationId)) {
    throw new HttpError(403, "The GitHub App installation needs Actions Secrets write permission before BYOK can be disconnected.");
  }
  const byokToken = await repositoryByokToken(session, repo, installationId);
  try {
    await github(`/repos/${encodedRepository}/actions/secrets/${BYOK_SECRET_NAME}`, byokToken, { method: "DELETE" });
  } catch (error) {
    if (!(error instanceof GitHubError) || error.status !== 404) throw error;
  }
  sendJson(res, 200, {
    repository,
    byok: { configured: false, state: "not_connected", secretName: BYOK_SECRET_NAME, updatedAt: null },
  });
}

async function preflight(req, res) {
  const session = requireSession(req);
  const repository = validateRepository(queryValue(req, "repository"));
  const target = await inspectInstallTarget(repository, session);
  let files = target.installation.state === "fresh" ? buildSetupFiles() : [];
  let installable = target.installable;
  let setup = { state: "none" };
  let projectedPolicyFiles = 0;
  let evidenceOptions = [];
  let evidenceDiscovery = { state: "unavailable" };
  if (target.installable && (target.installation.state === "fresh"
    || target.installation.policyMigration?.required)) {
    try {
      let recentPulls = [];
      try {
        const payload = await github(
          `/repos/${target.encodedRepository}/pulls?state=open&sort=updated&direction=desc&per_page=5`,
          session.token,
        );
        if (Array.isArray(payload)) recentPulls = payload;
      } catch {
        // The default branch still provides useful discovery when no pull request can be listed.
      }
      const candidateHeads = [...new Set([
        ...recentPulls
          .filter((pull) => pull?.head?.repo?.full_name === target.repo.full_name && /^[a-f0-9]{40}$/u.test(pull?.head?.sha ?? ""))
          .map((pull) => pull.head.sha),
        target.baseSha,
      ])].slice(0, 3);
      const payloads = await Promise.all(candidateHeads.map((headSha) => github(
        `/repos/${target.encodedRepository}/commits/${headSha}/check-runs?filter=latest&per_page=100`,
        session.token,
      )));
      const evidenceScore = (name) => {
        if (/\b(e2e|integration|unit|tests?|ci)\b/iu.test(name)) return 2;
        if (/\b(build|typecheck)\b/iu.test(name)) return 1;
        return 0;
      };
      const candidates = payloads.flatMap((payload) => Array.isArray(payload?.check_runs) ? payload.check_runs : [])
        .filter((check) => typeof check?.name === "string" && check.name.length > 0 && check.name.length <= 100
          && !RESERVED_CHANGEPLANE_CHECK_NAMES.has(check.name)
          && typeof check?.app?.slug === "string" && check.app.slug.length > 0)
        .map((check) => ({ check, score: evidenceScore(check.name) }))
        .sort((left, right) => right.score - left.score || left.check.name.localeCompare(right.check.name))
        .slice(0, 24);
      const actionRuns = new Map();
      const enriched = await Promise.all(candidates.map(async ({ check, score }) => {
        if (check.app.slug !== "github-actions") {
          return { name: check.name, appSlug: check.app.slug, score };
        }
        const runId = canonicalGithubActionsRunId(check.details_url, repository);
        if (!runId || !/^[a-f0-9]{40}$/u.test(check.head_sha ?? "")) return null;
        if (!actionRuns.has(runId)) {
          actionRuns.set(runId, github(
            `/repos/${target.encodedRepository}/actions/runs/${runId}`,
            session.token,
          ));
        }
        const run = await actionRuns.get(runId);
        const workflowPath = githubWorkflowFilePath(run?.path);
        if (String(run?.id ?? "") !== runId || run?.head_sha !== check.head_sha
          || workflowPath == null) return null;
        return {
          name: check.name,
          appSlug: check.app.slug,
          workflowPath,
          score,
        };
      }));
      const seen = new Set();
      const unique = enriched.filter(Boolean).filter((option) => {
        const key = `${option.name}\0${option.appSlug}\0${option.workflowPath ?? ""}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, 8);
      const suggestedIndex = unique.findIndex(({ score }) => score > 0);
      evidenceOptions = unique.map(({ score: _score, ...option }, index) => ({
        ...option,
        suggested: index === suggestedIndex,
      }));
      evidenceDiscovery = {
        state: evidenceOptions.length > 0 ? "found" : "empty",
        checkedHeads: candidateHeads.length,
      };
    } catch {
      // Evidence discovery is optional and read-only; the UI falls back to explicit scope-only assurance.
    }
  }
  if (target.installable && target.installation.state === "fresh") {
    const existingPullRequest = await findObserveSetupPullRequest(target.encodedRepository, target.repo, session.token, files);
    if (existingPullRequest) {
      try {
        const existingPlan = readObserveSetupPlan(existingPullRequest.body, files);
        if (!existingPlan) {
          throw new HttpError(409, "The existing setup PR uses an unsupported or unsafe setup plan.");
        }
        files = buildSetupFiles(existingPlan.requiredCheck, existingPlan.harnessMode);
        await validateObserveSetupPullRequest(target.encodedRepository, existingPullRequest, target.baseSha, files, session.token);
        setup = {
          state: "pending",
          pullRequest: { number: existingPullRequest.number, url: existingPullRequest.html_url },
          requiredCheck: existingPlan.requiredCheck,
          harnessMode: existingPlan.harnessMode,
        };
      } catch (error) {
        if (!(error instanceof HttpError) || error.status !== 409) throw error;
        installable = false;
        setup = {
          state: "stale",
          pullRequest: { number: existingPullRequest.number, url: existingPullRequest.html_url },
          message: `Setup PR #${existingPullRequest.number} does not match the current installer. Close it and delete ${OBSERVE_SETUP_BRANCH}, then retry.`,
        };
      }
    } else if (await readObserveSetupHead(target.encodedRepository, session.token)) {
      installable = false;
      setup = {
        state: "stale",
        message: `Branch ${OBSERVE_SETUP_BRANCH} already exists without a verifiable setup PR. Delete the branch, then retry.`,
      };
    }
  } else if (target.installable && target.installation.state === "outdated") {
    const currentPolicy = await readRepositoryFile(
      target.encodedRepository,
      POLICY_PATH,
      target.baseSha,
      session.token,
    );
    const migration = classifyUpgradePolicyMigration(currentPolicy);
    let upgrade = await managedUpgradeFiles(target.encodedRepository, target.baseSha, session.token);
    files = upgrade.files;
    projectedPolicyFiles = migration ? 1 : 0;
    const existingPullRequest = await findObserveUpgradePullRequest(
      target.encodedRepository,
      target.repo,
      session.token,
    );
    if (existingPullRequest) {
      try {
        const existingPlan = readObserveUpgradePlan(existingPullRequest.body);
        if (!existingPlan) {
          throw new HttpError(409, "The existing upgrade PR uses an unsupported or invalid plan.");
        }
        let recovery = null;
        if (migration) {
          if (!existingPlan.policyRecovery) {
            throw new HttpError(409, "The existing upgrade PR predates the required v13 policy recovery.");
          }
          const choice = existingPlan.policyRecovery;
          const policyContent = buildUpgradeRecoveryPolicy(
            currentPolicy,
            choice?.requiredCheck ?? null,
            choice?.harnessMode,
          );
          const policy = JSON.parse(policyContent);
          recovery = {
            policyContent,
            harnessMode: policy.harness.mode,
            requiredCheck: policy.evidence.requiredChecks[0] ?? null,
          };
          upgrade = await managedUpgradeFiles(
            target.encodedRepository,
            target.baseSha,
            session.token,
            policyContent,
          );
          files = upgrade.files;
          projectedPolicyFiles = 0;
        } else if (existingPlan?.policyRecovery) {
          throw new HttpError(409, "The upgrade PR contains an unexpected policy recovery.");
        }
        const expectedPlan = observeUpgradePlan(files, recovery);
        await validateObserveUpgradePullRequest(
          target.encodedRepository,
          existingPullRequest,
          target.baseSha,
          files,
          upgrade.expectedStatuses,
          expectedPlan,
          session.token,
        );
        setup = {
          state: "pending",
          operation: "upgrade",
          pullRequest: { number: existingPullRequest.number, url: existingPullRequest.html_url },
          harnessMode: recovery?.harnessMode ?? HARNESS_MODE.OBSERVE,
          requiredCheck: recovery?.requiredCheck ?? null,
          policyIncluded: Boolean(recovery),
          ...(recovery ? { policyMigration: migration } : {}),
        };
      } catch (error) {
        if (!(error instanceof HttpError) || error.status !== 409) throw error;
        installable = false;
        setup = {
          state: "stale",
          operation: "upgrade",
          pullRequest: { number: existingPullRequest.number, url: existingPullRequest.html_url },
          message: `Upgrade PR #${existingPullRequest.number} does not match the current installer. Close it and delete ${OBSERVE_UPGRADE_BRANCH}, then retry.`,
        };
      }
    } else if (await readBranchHead(target.encodedRepository, OBSERVE_UPGRADE_BRANCH, session.token)) {
      installable = false;
      setup = {
        state: "stale",
        operation: "upgrade",
        message: `Branch ${OBSERVE_UPGRADE_BRANCH} already exists without a verifiable upgrade PR. Delete the branch, then retry.`,
      };
    } else {
      setup = {
        state: "upgrade_available",
        operation: "upgrade",
        ...(migration ? { policyMigration: migration } : {}),
      };
    }
  } else if (target.installation.state === "outdated"
    && target.installation.policyMigration?.required
    && !target.installation.policyMigration.ownerAuthorized) {
    setup = {
      state: "owner_required",
      operation: "upgrade",
      message: "A repository administrator must select the exact behavioral Check and workflow path, then create and review the protected v13 recovery pull request. Nothing was changed.",
      policyMigration: target.installation.policyMigration,
    };
  } else if (target.installation.state === "current") {
    setup = { state: "current", managedVersion: MANAGED_VERSION };
  } else if (target.installation.state === "conflict") {
    setup = {
      state: "conflict",
      message: `ChangePlane will not overwrite repository-owned or modified paths: ${target.conflicts.join(", ")}`,
    };
  }
  const verifyLiteFiles = buildSetupFiles();
  const fullManagedFiles = buildManagedFiles(MANAGED_PROFILE.FULL);
  const setupProfile = setup.state === "pending" && setup.harnessMode === HARNESS_MODE.AUTONOMOUS
    ? MANAGED_PROFILE.FULL
    : target.installation.state === "fresh"
      ? MANAGED_PROFILE.VERIFY_LITE
      : target.installation.state === "outdated"
        ? target.installation.managedProfile ?? MANAGED_PROFILE.FULL
        : Object.values(MANAGED_PROFILE).includes(target.installation.managedProfile)
          ? target.installation.managedProfile
          : null;
  const fullCapabilities = setupProfile === MANAGED_PROFILE.FULL;
  sendJson(res, 200, {
    repository: target.repo.full_name,
    defaultBranch: target.repo.default_branch,
    repositoryState: target.repositoryState,
    installation: target.installation,
    installable,
    conflicts: target.conflicts,
    setupFiles: files.length + projectedPolicyFiles,
    setupProfile,
    payloadProfiles: {
      verifyLite: {
        managedProfile: MANAGED_PROFILE.VERIFY_LITE,
        files: verifyLiteFiles.length,
        repairAuthority: false,
        providerKeyRequired: false,
      },
      autonomous: {
        managedProfile: MANAGED_PROFILE.FULL,
        files: fullManagedFiles.length + 3,
        repairAuthority: true,
        providerKeyRequired: true,
      },
    },
    setup,
    evidenceOptions,
    evidenceDiscovery,
    harness: {
      verifyAvailable: true,
      autonomousAvailable: repairControllerConfiguration().provisioningConfigured,
      maxAttempts: HARNESS_MAX_ATTEMPTS,
      budgetMinutes: HARNESS_BUDGET_MINUTES,
    },
    capabilities: {
      independentReview: fullCapabilities,
      agentHandback: true,
      assuranceMemory: fullCapabilities,
      exactHeadPreview: true,
      mergeQueue: true,
    },
    boundary: {
      defaultBranchWrite: false,
      pullRequestOnly: true,
      mergeBlocking: false,
      agentRepairDuringSetup: false,
      untrustedCodeExecution: false,
      providerSecretAccess: false,
    },
  });
}

function validateAssuranceLevel(value) {
  if (value === "strict_head" || value === "queue_certified") return value;
  throw new HttpError(400, "assuranceLevel must be strict_head or queue_certified.");
}

async function liveRulesetPlan(repository, assuranceLevel, session) {
  const target = await requireRepositoryAdmin(repository, session);
  const runtime = await readRepositoryRuntime(target.encodedRepository, target.repo, session.token);
  if (runtime.content == null) {
    throw new HttpError(409, "Merge the protected ChangePlane setup pull request before configuring the GitHub Ruleset.");
  }
  const rulesets = await readRepositoryRulesets(target.encodedRepository, session.token);
  if (rulesets === null) {
    throw new HttpError(409, "GitHub returned an ambiguous Ruleset inventory. Nothing was changed.");
  }
  const publishers = await enforcementPublisherAppIdentities(
    target.encodedRepository,
    target.repo,
    session.token,
    runtime.requiredChecks,
  );
  if (publishers.guard == null) {
    throw new HttpError(409, "Run ChangePlane on one pull request so GitHub records the Guard App publisher, then retry. Nothing was changed.");
  }
  const missingEvidence = publishers.evidence.find(({ integrationId }) => integrationId == null);
  if (missingEvidence) {
    throw new HttpError(409, `Run ${missingEvidence.name} on one pull request so GitHub records its publisher, then retry. Nothing was changed.`);
  }
  return {
    target,
    runtime,
    plan: buildRulesetPlan({
      repository: {
        id: target.repo.id,
        fullName: target.repo.full_name,
        defaultBranch: target.repo.default_branch,
        defaultBranchSha: runtime.baseSha,
      },
      assuranceLevel,
      guardIntegrationId: publishers.guard,
      evidenceChecks: publishers.evidence,
      rulesets,
    }),
  };
}

async function rulesetPlanStatus(req, res) {
  const session = requireSession(req);
  const repository = validateRepository(queryValue(req, "repository"));
  const assuranceLevel = validateAssuranceLevel(queryValue(req, "assuranceLevel") ?? "strict_head");
  const { plan } = await liveRulesetPlan(repository, assuranceLevel, session);
  sendJson(res, 200, { plan });
}

async function applyRulesetPlan(req, res) {
  assertOrigin(req);
  const session = requireSession(req);
  assertCsrf(req, session);
  assertJsonRequest(req);
  const body = await readJson(req);
  const repository = validateRepository(body.repository);
  const assuranceLevel = validateAssuranceLevel(body.assuranceLevel);
  if (typeof body.planDigest !== "string" || !/^[a-f0-9]{64}$/u.test(body.planDigest)) {
    throw new HttpError(400, "planDigest must be the exact digest shown in the approved Ruleset plan.");
  }

  const first = await liveRulesetPlan(repository, assuranceLevel, session);
  if (first.plan.action === "none") {
    sendJson(res, 200, {
      repository,
      state: "already_active",
      enforcement: first.plan.readiness,
      planDigest: first.plan.planDigest,
    });
    return;
  }
  if (first.plan.action !== "create") {
    throw new HttpError(409, `${first.plan.summary} Nothing was changed.`);
  }
  if (first.plan.planDigest !== body.planDigest) {
    throw new HttpError(409, "The repository revision, publishers, or Ruleset inventory changed after approval. Review the fresh plan; nothing was changed.");
  }

  // Rebuild immediately before mutation so an older browser approval cannot authorize newer policy bytes.
  const fresh = await liveRulesetPlan(repository, assuranceLevel, session);
  if (fresh.plan.action !== "create" || fresh.plan.planDigest !== body.planDigest) {
    throw new HttpError(409, "The approved Ruleset plan became stale before apply. Review the fresh plan; nothing was changed.");
  }
  const created = await github(fresh.plan.mutation.path, session.token, {
    method: fresh.plan.mutation.method,
    body: fresh.plan.mutation.body,
  });
  if (!Number.isSafeInteger(created?.id) || created.id < 1
    || created.name !== fresh.plan.mutation.body.name
    || created.target !== "branch"
    || created.enforcement !== "active") {
    throw new HttpError(502, "GitHub returned an invalid Ruleset after apply. Inspect repository policy before retrying.");
  }

  const enforcement = await readGuardEnforcement(
    fresh.target.encodedRepository,
    fresh.target.repo,
    session.token,
    { isAdmin: true, requiredChecks: fresh.runtime.requiredChecks },
  );
  const requestedActive = enforcement.active
    && (assuranceLevel === "strict_head" || enforcement.queueCertified);
  sendJson(res, 200, {
    repository,
    state: requestedActive ? "applied" : "applied_reconciliation_required",
    planDigest: fresh.plan.planDigest,
    ruleset: {
      id: created.id,
      name: created.name,
      url: `https://github.com/${repository}/rules/${created.id}`,
    },
    enforcement,
  });
}

async function reconcileGuard(req, res, suppliedJournal) {
  const journalRuntime = guardJournalRuntime(suppliedJournal);
  assertOrigin(req);
  const session = requireSession(req);
  assertCsrf(req, session);
  assertJsonRequest(req);
  const body = await readJson(req);
  const repository = validateRepository(body.repository);
  const checkRunId = Number(body.checkRunId);
  if (!Number.isSafeInteger(checkRunId) || checkRunId < 1 || String(checkRunId) !== String(body.checkRunId)) {
    throw new HttpError(400, "checkRunId must be one positive GitHub Check Run identifier.");
  }
  const target = await requireRepositoryAdmin(repository, session);
  if (!Number.isSafeInteger(target.repo?.id) || target.repo.id < 1) {
    throw new HttpError(502, "GitHub returned an invalid repository identity.");
  }
  const configuration = guardPublisherConfiguration();
  const appJwt = createGitHubAppJwt({ appId: configuration.appId, privateKey: configuration.privateKey });
  const installation = await github(`/repos/${target.encodedRepository}/installation`, appJwt);
  if (!Number.isSafeInteger(installation?.id) || installation.id < 1
    || installation.app_id !== configuration.appId
    || installation.app_slug !== configuration.appSlug) {
    throw new HttpError(403, "The repository is not bound to the configured Guard App.");
  }
  const readCredential = await createGuardReadInstallationAccessToken({
    appId: configuration.appId,
    privateKey: configuration.privateKey,
    installationId: installation.id,
    repositoryId: target.repo.id,
    request: github,
  });
  const readCheck = () => github(
    `/repos/${target.encodedRepository}/check-runs/${checkRunId}`,
    readCredential.token,
  );
  const readBaseRef = () => github(
    `/repos/${target.encodedRepository}/git/ref/heads/${encodeRef(target.repo.default_branch)}`,
    readCredential.token,
  );
  // Check head_sha is immutable. Discovery chooses a lane only; every mutable
  // decision is re-read after acquiring it, including the Check publisher/head.
  const discovered = await readCheck();
  const headSha = discovered?.head_sha;
  if (!/^[a-f0-9]{40}$/u.test(headSha ?? "") || discovered?.name !== GUARD_CHECK_NAME
    || discovered?.app?.id !== configuration.appId || discovered?.app?.slug !== configuration.appSlug) {
    throw new HttpError(409, "The Guard recovery target cannot be authenticated. Nothing was changed.");
  }
  const result = await withGuardPublication(journalRuntime, {
    repo: target.repo, installation, configuration, headSha, operation: "reconcile",
  }, async ({ write }) => {
    const baseRef = await readBaseRef();
    const { workflowSha, trustedHarnessMode } = await guardManagedBase(
      target.encodedRepository,
      target.repo.default_branch,
      baseRef?.object?.sha,
      readCredential.token,
    );
    let checkRun = await readCheck();
    if (checkRun?.head_sha !== headSha || checkRun?.name !== GUARD_CHECK_NAME
      || checkRun?.app?.id !== configuration.appId || checkRun?.app?.slug !== configuration.appSlug) {
      throw new HttpError(409, "Only the configured Guard App Check can be reconciled. Nothing was changed.");
    }
    const recoveryContext = { encodedRepository: target.encodedRepository, repo: target.repo, configuration, trustedHarnessMode, token: readCredential.token };
    let reconciliation = await trustedGuardRecoveryState({ ...recoveryContext, checkRun });
    if (reconciliation.patch == null) {
      return { repository, ...reconciliation };
    }

    const recoveryGeneration = reconciliation.generation;
    const writeCredential = await createChecksWriteInstallationAccessToken({
      appId: configuration.appId,
      privateKey: configuration.privateKey,
      installationId: installation.id,
      repositoryId: target.repo.id,
      request: github,
    });
    const [finalCheckRun, finalBaseRef] = await Promise.all([readCheck(), readBaseRef()]);
    checkRun = finalCheckRun;
    if (finalBaseRef?.object?.sha !== workflowSha
      || checkRun?.head_sha !== headSha || checkRun?.name !== GUARD_CHECK_NAME
      || checkRun?.app?.id !== configuration.appId || checkRun?.app?.slug !== configuration.appSlug) {
      throw new HttpError(409, "The trusted recovery policy or Guard publisher changed before reconciliation. Nothing was changed.");
    }
    reconciliation = await trustedGuardRecoveryState({ ...recoveryContext, checkRun });
    if (reconciliation.patch == null) {
      return { repository, ...reconciliation };
    }
    if (reconciliation.generation !== recoveryGeneration) {
      throw new HttpError(409, "The owning Guard generation changed before reconciliation. Nothing was changed.");
    }
    const published = await write(() => github(
      `/repos/${target.encodedRepository}/check-runs/${checkRunId}`,
      writeCredential.token,
      { method: "PATCH", body: reconciliation.patch },
    ));
    if (published?.id !== checkRunId || published?.head_sha !== headSha
      || published?.name !== GUARD_CHECK_NAME || published?.app?.id !== configuration.appId
      || published?.app?.slug !== configuration.appSlug
      || published.status !== "completed"
      || published.conclusion !== "action_required"
      || published?.output?.text !== reconciliation.patch.output.text) {
      throw new HttpError(502, "GitHub did not return the safely reconciled Guard Check.");
    }
    return {
      repository,
      state: "reconciled",
      checkRunId,
      generation: reconciliation.generation,
      conclusion: "action_required",
    };
  });
  sendJson(res, 200, result);
}

export async function prepareAutonomousHarness(repository, session, authorityAnchor = null) {
  const configuration = repairControllerConfiguration();
  if (!configuration.provisioningConfigured) {
    throw new HttpError(503, "Autonomous repair is temporarily unavailable. Observe mode remains available.");
  }
  if (authorityAnchor?.state === "fresh") {
    throw new HttpError(409, "Install Verify Lite first. After its dedicated-App guard and behavioral evidence are required in a no-bypass merge-queue ruleset, expand to Autonomous through a separate protected pull request.");
  }
  let target = await requireRepositoryAdmin(repository, session);
  const { encodedRepository, installationId } = target;
  if (session.authMode !== "github_app" || !Number.isSafeInteger(target.repo?.id) || target.repo.id < 1
    || !/^[1-9][0-9]{0,19}$/u.test(String(installationId ?? ""))) {
    throw new HttpError(409, "Autonomous repair requires the repository-scoped ChangePlane GitHub App.");
  }
  await requireAutonomousBranchProtection(encodedRepository, target.repo, session.token);
  if (!await installationCanWriteSecrets(session, installationId)) {
    throw new HttpError(403, "The GitHub App installation needs Actions Secrets write permission before autonomous repair can be enabled.");
  }
  const token = await repositoryByokToken(session, target.repo, installationId);
  const byok = await readByokStatus(repository, token);
  if (!byok.configured) {
    throw new HttpError(409, "Add an OpenAI key before enabling autonomous repair.");
  }
  let verifiedAuthorityAnchor = await requireAutonomousAuthorityAnchor(
    session,
    target,
    authorityAnchor,
  );

  let publicKeys;
  let controllerSecret;
  try {
    const privateKey = String(process.env.GITHUB_APP_PRIVATE_KEY ?? "").replaceAll("\\n", "\n").trim();
    const publicKey = createPublicKey(privateKey);
    publicKeys = JSON.stringify({
      [repairLedgerKeyId(publicKey)]: repairLedgerPublicKeyValue(publicKey),
    });
    controllerSecret = deriveControllerSecret({
      masterSecret: process.env.CHANGEPLANE_CONTROLLER_SECRET,
      installationId: Number(installationId),
      repositoryId: target.repo.id,
      repository,
    });
  } catch {
    throw new HttpError(503, "Autonomous controller identity is unavailable. Observe mode remains available.");
  }

  const publicKey = await repositoryActionsPublicKey(encodedRepository, token);
  // Provision fail-closed: an interrupted rotation must leave repair disabled.
  await putRepositoryActionsSecret(
    encodedRepository,
    token,
    publicKey,
    HARNESS_SECRETS.enabled,
    "false",
  );
  // V11 and earlier workflows reference only the legacy name. Replace it before
  // provisioning the v12-domain credential so an old trusted-base bug cannot
  // leak a credential that the v12 controller will accept after upgrade.
  await putRepositoryActionsSecret(
    encodedRepository,
    token,
    publicKey,
    HARNESS_SECRETS.legacyController,
    LEGACY_CONTROLLER_TOMBSTONE,
  );
  await putRepositoryActionsSecret(
    encodedRepository,
    token,
    publicKey,
    HARNESS_SECRETS.controller,
    LEGACY_CONTROLLER_TOMBSTONE,
  );
  for (const [name, value] of [
    [HARNESS_SECRETS.installation, String(installationId)],
    [HARNESS_SECRETS.generation, String(configuration.generation)],
    [HARNESS_SECRETS.publicKeys, publicKeys],
  ]) {
    await putRepositoryActionsSecret(encodedRepository, token, publicKey, name, value);
  }
  target = await revalidateRepositoryAdmin(target, repository, session);
  await requireAutonomousBranchProtection(encodedRepository, target.repo, session.token);
  verifiedAuthorityAnchor = await requireAutonomousAuthorityAnchor(
    session,
    target,
    verifiedAuthorityAnchor,
  );
  await putRepositoryActionsSecret(
    encodedRepository,
    token,
    publicKey,
    HARNESS_SECRETS.enabled,
    MANAGED_REPAIR_ACTIVATION,
  );
  // The usable controller credential is written last. Any interrupted rotation
  // therefore leaves either the repair switch disabled or a tombstoned HMAC.
  await putRepositoryActionsSecret(
    encodedRepository,
    token,
    publicKey,
    HARNESS_SECRETS.controller,
    controllerSecret,
  );
}

async function install(req, res) {
  assertOrigin(req);
  const session = requireSession(req);
  assertCsrf(req, session);
  assertJsonRequest(req);
  const body = await readJson(req);
  const repository = validateRepository(body.repository);
  if (!Object.hasOwn(body, "requiredCheck")) {
    throw new HttpError(400, "Choose one required GitHub check or explicitly continue with commit-and-scope-only receipts.");
  }
  const harnessMode = Object.hasOwn(body, "harnessMode")
    ? harnessPolicy({ mode: body.harnessMode }).mode
    : HARNESS_MODE.VERIFY;
  const requiredCheck = validateRequiredCheck(body.requiredCheck, {
    requireWorkflowPath: harnessMode !== HARNESS_MODE.OBSERVE,
  });
  if (harnessMode === HARNESS_MODE.VERIFY && !requiredCheck) {
    throw new HttpError(400, "Verify only requires one exact behavioral check and publisher.");
  }
  if (harnessMode === HARNESS_MODE.OBSERVE && requiredCheck) {
    throw new HttpError(400, "Scope-only Observe must be selected explicitly and cannot include a behavioral required Check.");
  }
  if (harnessMode === HARNESS_MODE.AUTONOMOUS) {
    if (!requiredCheck) throw new HttpError(400, "Autonomous repair requires one exact behavioral check and publisher.");
    throw new HttpError(409, "Install Verify Lite first, activate its protected merge gate, then expand to Autonomous through a separate reviewed pull request.");
  }
  const result = await createObservePullRequest(repository, session, requiredCheck, harnessMode);
  sendJson(res, 201, result);
}

async function repair(req, res) {
  const configuration = repairControllerConfiguration();
  if (!configuration.configured) {
    throw new HttpError(503, "The dedicated ChangePlane repair controller is disabled or incomplete.");
  }
  assertJsonRequest(req);
  const body = await readJson(req, { maxBytes: MAX_REPAIR_BODY_BYTES });
  try {
    validateControllerRequest(body);
  } catch {
    throw new HttpError(400, "Repair controller request is invalid.");
  }
  const deliveryId = header(req, "x-changeplane-delivery");
  const signature = header(req, "x-changeplane-signature");
  let controllerSecret;
  try {
    controllerSecret = deriveControllerSecret({
      masterSecret: process.env.CHANGEPLANE_CONTROLLER_SECRET,
      installationId: body.change.installationId,
      repositoryId: body.change.repositoryId,
      repository: body.change.repository,
    });
    verifyControllerRequest({ secret: controllerSecret, deliveryId, signature, request: body });
  } catch {
    throw new HttpError(403, "Repair controller request authentication failed.");
  }
  const result = await publishTrustedRepair({
    controllerRequest: body,
    appId: process.env.GITHUB_APP_ID,
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY,
    publisherReleaseSha: process.env.VERCEL_GIT_COMMIT_SHA,
    generation: configuration.generation,
    enabled: configuration.enabled,
    expectedRepository: configuration.repository,
    request: github,
  });
  sendJson(res, 202, result);
}

async function repairClaim(req, res) {
  const configuration = repairControllerConfiguration();
  if (!configuration.configured) {
    throw new HttpError(503, "The dedicated ChangePlane repair controller is disabled or incomplete.");
  }
  assertJsonRequest(req);
  const body = await readJson(req, { maxBytes: MAX_BODY_BYTES });
  try {
    validateClaimRequest(body);
  } catch {
    throw new HttpError(400, "Repair claim request is invalid.");
  }
  const deliveryId = header(req, "x-changeplane-delivery");
  const signature = header(req, "x-changeplane-signature");
  try {
    const secret = deriveControllerSecret({
      masterSecret: process.env.CHANGEPLANE_CONTROLLER_SECRET,
      installationId: body.installationId,
      repositoryId: body.repositoryId,
      repository: body.repository,
    });
    verifyClaimRequest({ secret, deliveryId, signature, request: body });
  } catch {
    throw new HttpError(403, "Repair claim authentication failed.");
  }
  const result = await claimTrustedRepair({
    claimRequest: body,
    appId: process.env.GITHUB_APP_ID,
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY,
    generation: configuration.generation,
    enabled: configuration.enabled,
    expectedRepository: configuration.repository,
    expectedPublisherReleaseSha: process.env.VERCEL_GIT_COMMIT_SHA,
    expectedActorLogin: `${githubAppSlug()}[bot]`,
    request: github,
  });
  sendJson(res, 200, result);
}

async function repairValidate(req, res) {
  const configuration = repairControllerConfiguration();
  if (!configuration.configured) {
    throw new HttpError(503, "The dedicated ChangePlane repair controller is disabled or incomplete.");
  }
  assertJsonRequest(req);
  const body = await readJson(req, { maxBytes: MAX_BODY_BYTES });
  try {
    validateClaimRequest(body);
    const secret = deriveControllerSecret({
      masterSecret: process.env.CHANGEPLANE_CONTROLLER_SECRET,
      installationId: body.installationId,
      repositoryId: body.repositoryId,
      repository: body.repository,
    });
    verifyClaimRequest({
      secret,
      deliveryId: header(req, "x-changeplane-delivery"),
      signature: header(req, "x-changeplane-signature"),
      request: body,
    });
  } catch {
    throw new HttpError(403, "Repair validation authentication failed.");
  }
  const result = await validateTrustedRepair({
    claimRequest: body,
    appId: process.env.GITHUB_APP_ID,
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY,
    generation: configuration.generation,
    enabled: configuration.enabled,
    expectedRepository: configuration.repository,
    expectedPublisherReleaseSha: process.env.VERCEL_GIT_COMMIT_SHA,
    expectedActorLogin: `${githubAppSlug()}[bot]`,
    request: github,
  });
  sendJson(res, 200, result);
}

async function repairPushToken(req, res) {
  const configuration = repairControllerConfiguration();
  if (!configuration.configured) {
    throw new HttpError(503, "The dedicated ChangePlane repair controller is disabled or incomplete.");
  }
  assertJsonRequest(req);
  const body = await readJson(req, { maxBytes: MAX_BODY_BYTES });
  try {
    validateClaimRequest(body);
    const secret = deriveControllerSecret({
      masterSecret: process.env.CHANGEPLANE_CONTROLLER_SECRET,
      installationId: body.installationId,
      repositoryId: body.repositoryId,
      repository: body.repository,
    });
    verifyClaimRequest({
      secret,
      deliveryId: header(req, "x-changeplane-delivery"),
      signature: header(req, "x-changeplane-signature"),
      request: body,
    });
  } catch {
    throw new HttpError(403, "Repair push credential authentication failed.");
  }
  const result = await issueTrustedRepairPushToken({
    claimRequest: body,
    appId: process.env.GITHUB_APP_ID,
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY,
    generation: configuration.generation,
    enabled: configuration.enabled,
    expectedRepository: configuration.repository,
    expectedPublisherReleaseSha: process.env.VERCEL_GIT_COMMIT_SHA,
    expectedActorLogin: `${githubAppSlug()}[bot]`,
    request: github,
  });
  sendJson(res, 200, result);
}

async function logout(req, res) {
  assertOrigin(req);
  const session = requireSession(req);
  assertCsrf(req, session);
  sendJson(res, 200, { authenticated: false }, [clearCookie(SESSION_COOKIE), clearCookie(OAUTH_COOKIE)]);
}

async function handleRequest(req, res, suppliedJournal, suppliedPilotAdmission) {
  const requestId = apiRequestId(req);
  const startedAt = Date.now();
  const method = String(req.method ?? "GET").toUpperCase();
  let action = null;
  applyApiHeaders(res, requestId);
  try {
    action = queryValue(req, "action");
    const allowedMethods = ROUTE_METHODS.get(action);
    if (!allowedMethods) throw new HttpError(404, "Unknown GitHub API action.");
    if (!allowedMethods.includes(method)) {
      res.setHeader("allow", allowedMethods.join(", "));
      throw new HttpError(405, "Method not allowed for this API action.");
    }
    if (EXTERNAL_ACCESS_ACTIONS.has(action)) {
      assertExternalAccessSourceProvenance();
      assertRolloutAccessAuthorized();
    }
    if (method === "GET" && action === "readiness") {
      const state = readiness();
      sendJson(res, state.ready ? 200 : 503, {
        status: state.ready ? "ready" : "configuration_required",
        commercialReady: state.commercialReady,
        principalSeparation: state.principalSeparation,
        checks: state.checks,
        authMode: state.authMode,
        rolloutMode: state.rolloutMode,
        release: state.release,
        managedRuntime: state.managedRuntime,
        repairController: {
          enabled: state.repairController.enabled,
          configured: state.repairController.configured,
          checks: state.repairController.checks,
        },
      });
      return;
    }
    if (method === "GET" && action === "origin-proof") {
      sendJson(res, 200, runOriginBoundaryProof());
      return;
    }
    if (method === "GET" && action === "session") {
      const session = readSession(req);
      const configured = oauthIsConfigured() && hasSourceProvenance();
      const mode = rolloutMode();
      const accessBlock = rolloutAccessBlock();
      sendJson(res, 200, session && configured ? {
        authenticated: true,
        configured,
        authMode: session.authMode,
        rolloutMode: mode,
        login: session.login,
        csrf: session.csrf,
        expiresAt: session.exp,
      } : {
        authenticated: false,
        configured,
        authMode: githubAppSlug() ? "github_app" : "oauth",
        rolloutMode: mode,
        ...(accessBlock ? { accessBlock } : {}),
      });
      return;
    }
    if (method === "GET" && action === "login") return await login(req, res);
    if (method === "GET" && action === "authorize") return await authorizeExisting(req, res);
    if (method === "GET" && action === "installation") return await installation(req, res);
    if (method === "GET" && action === "callback") return await callback(req, res);
    if (method === "GET" && action === "repos") return await repositories(req, res);
    if (method === "GET" && action === "preflight") return await preflight(req, res);
    if (method === "GET" && action === "ruleset-plan") return await rulesetPlanStatus(req, res);
    if (method === "POST" && action === "ruleset-apply") return await applyRulesetPlan(req, res);
    if (method === "POST" && action === "reconcile") return await reconcileGuard(req, res, suppliedJournal);
    if (method === "GET" && action === "runtime") return await runtimeStatus(req, res);
    if (method === "GET" && action === "proof") return await assuranceProofStatus(req, res);
    if (method === "POST" && action === "guard-publish") return await guardPublish(req, res, suppliedJournal, suppliedPilotAdmission);
    if (method === "POST" && action === "runtime") return await configureRuntime(req, res);
    if (method === "GET" && action === "byok") return await runtimeStatus(req, res);
    if (method === "POST" && action === "byok") return await configureByok(req, res);
    if (method === "DELETE" && action === "byok") return await disconnectByok(req, res);
    if (method === "POST" && action === "install") return await install(req, res);
    if (method === "POST" && action === "repair") return await repair(req, res);
    if (method === "POST" && action === "repair-claim") return await repairClaim(req, res);
    if (method === "POST" && action === "repair-push-token") return await repairPushToken(req, res);
    if (method === "POST" && action === "repair-validate") return await repairValidate(req, res);
    if (method === "POST" && action === "logout") return await logout(req, res);
    throw new HttpError(404, "Unknown GitHub API action.");
  } catch (error) {
    const status = error instanceof GuardPublicationError
      ? error.code === "GUARD_PUBLICATION_BUSY" ? 423 : 503
      : error instanceof HttpError
      ? error.status
      : error instanceof GitHubError && error.status >= 400 && error.status < 500
        ? error.status
        : 500;
    const message = error instanceof GuardPublicationError
      ? error.code === "GUARD_PUBLICATION_BUSY"
        ? "A previous publication still holds this revision. Its required Guard remains in force. Re-run ChangePlane; if it stays blocked, ask the release owner to inspect the request ID."
        : "Guard publication is paused because its authority journal could not confirm a safe operation. Keep the required Guard and ask the release owner to inspect the request ID."
      : error instanceof HttpError
      ? error.message
      : error instanceof GitHubError
        ? `GitHub request failed (${error.status}).${error.requestId ? ` GitHub request ${error.requestId}.` : ""}`
        : "GitHub connection failed.";
    if (error instanceof GitHubError && error.retryDelayMs > SERVERLESS_MAX_RETRY_DELAY_MS) {
      res.setHeader("retry-after", String(Math.ceil(error.retryDelayMs / 1000)));
    }
    if (error instanceof GuardPublicationError && status === 423) res.setHeader("retry-after", "1");
    sendJson(res, status, { error: message, requestId,
      ...(error instanceof GuardPublicationError || error instanceof PilotAdmissionBlock ? { code: error.code } : {}) });
    logApiRequest(status >= 500 ? "error" : "warn", {
      event: "request_failed",
      requestId,
      action: typeof action === "string" ? action.slice(0, 32) : "unknown",
      method,
      status,
      durationMs: Date.now() - startedAt,
      errorType: error?.constructor?.name || "UnknownError",
      ...(error instanceof GuardPublicationError || error instanceof PilotAdmissionBlock ? { errorCode: error.code } : {}),
      ...(error instanceof GitHubError ? {
        githubStatus: error.status,
        githubRequestId: error.requestId,
      } : {}),
    });
    return;
  } finally {
    if (res.statusCode > 0 && res.statusCode < 400) {
      logApiRequest("info", {
        event: "request_completed",
        requestId,
        action: typeof action === "string" ? action.slice(0, 32) : "unknown",
        method,
        status: res.statusCode,
        durationMs: Date.now() - startedAt,
      });
    }
  }
}

export function createGitHubHandler({ guardJournal = null, pilotAdmission = null } = {}) {
  if (guardJournal !== null && typeof guardJournal?.withPublication !== "function") {
    throw new TypeError("A Guard publication journal must implement withPublication.");
  }
  if (pilotAdmission !== null && typeof pilotAdmission?.admitEvaluation !== "function") {
    throw new TypeError("Pilot admission must implement admitEvaluation.");
  }
  return (req, res) => handleRequest(req, res, guardJournal, pilotAdmission);
}

export default createGitHubHandler();
