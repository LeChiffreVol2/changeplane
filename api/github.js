import {
  createCipheriv,
  createDecipheriv,
  createHash,
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
  harnessPolicy,
} from "../src/lib/harness.js";
import { DEFAULT_EVIDENCE_PROTECTED_PATHS } from "../examples/changeplane-evidence-policy.js";
import {
  repairLedgerKeyId,
  repairLedgerPublicKeyValue,
} from "../server/repair-ledger.js";

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
  controller: "CHANGEPLANE_CONTROLLER_HMAC",
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
const MANAGED_VERSION = 11;
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
});
const TRANSIENT_GITHUB_STATUSES = new Set([502, 503, 504]);
const GITHUB_MAX_GET_ATTEMPTS = 3;
const SERVERLESS_MAX_RETRY_DELAY_MS = 2_000;
const REQUIRED_GITHUB_APP_PERMISSIONS = Object.freeze({
  contents: "write",
  pull_requests: "write",
  workflows: "write",
  checks: "read",
});
const OBSERVE_SETUP_BRANCH = "changeplane/observe-setup";
const OBSERVE_UPGRADE_BRANCH = `changeplane/observe-upgrade-v${MANAGED_VERSION}`;
const RUNTIME_CONFIG_BRANCH = "changeplane/runtime-model";
const GUARD_CHECK_NAME = "ChangePlane / guard";
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
  ["login", ["GET"]],
  ["authorize", ["GET"]],
  ["installation", ["GET"]],
  ["callback", ["GET"]],
  ["repos", ["GET"]],
  ["preflight", ["GET"]],
  ["runtime", ["GET", "POST"]],
  ["byok", ["GET", "POST", "DELETE"]],
  ["install", ["POST"]],
  ["repair", ["POST"]],
  ["repair-claim", ["POST"]],
  ["repair-push-token", ["POST"]],
  ["repair-validate", ["POST"]],
  ["logout", ["POST"]],
]);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
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

function rolloutMode() {
  if (process.env.CHANGEPLANE_SELF_SERVE_ENABLED === "true") return "self_serve";
  return process.env.CHANGEPLANE_CANARY_REPOSITORY || process.env.VERCEL === "1"
    ? "controlled_canary"
    : "self_serve";
}

function hasValidCanaryRepository() {
  if (rolloutMode() === "self_serve") return true;
  return Boolean(configuredCanaryRepository());
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
  return {
    enabled,
    configured: enabled && Boolean(githubAppSlug()) && Object.values(checks).every(Boolean),
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
  const checks = {
    githubClientId: Boolean(process.env.GITHUB_CLIENT_ID),
    githubClientSecret: Boolean(process.env.GITHUB_CLIENT_SECRET),
    githubAppSlug: mode === "controlled_canary"
      ? Boolean(appSlug)
      : process.env.GITHUB_APP_SLUG == null || Boolean(appSlug),
    sessionSecret: typeof process.env.CHANGEPLANE_SESSION_SECRET === "string"
      && process.env.CHANGEPLANE_SESSION_SECRET.length >= 32,
    appOrigin: Boolean(configuredAppOrigin()),
    sourceProvenance,
    canaryRepository: hasValidCanaryRepository(),
  };
  return {
    ready: Object.values(checks).every(Boolean),
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

function assertMutationSourceProvenance() {
  if (!hasSourceProvenance()) {
    throw new HttpError(503, "GitHub writes are disabled until this deployment is bound to a verified source commit.");
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
    && (rolloutMode() !== "controlled_canary" || appSlug)
    && (process.env.GITHUB_APP_SLUG == null || appSlug)
    && hasValidCanaryRepository()
  );
}

function githubAppSlug() {
  const value = process.env.GITHUB_APP_SLUG;
  if (value == null || value === "") return null;
  return /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/u.test(value) ? value : null;
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
  const controlledCanary = rolloutMode() === "controlled_canary";
  const canaryRepository = controlledCanary ? configuredCanaryRepository() : null;
  if (controlledCanary && process.env.CHANGEPLANE_CANARY_REPOSITORY && !canaryRepository) {
    throw new HttpError(503, "CHANGEPLANE_CANARY_REPOSITORY must contain one repository in owner/repository form. No GitHub request was made.");
  }
  if (canaryRepository && repository.toLowerCase() !== canaryRepository.toLowerCase()) {
    throw new HttpError(403, "This release can access only its approved test repository. Choose the repository shown in the installer or ask the release owner to update CHANGEPLANE_CANARY_REPOSITORY. Nothing was changed.");
  }
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
  const conflicts = installation.conflicts;
  const repositoryState = repo.archived ? "archived" : repo.disabled ? "disabled" : "active";
  return {
    encodedRepository,
    repo,
    baseSha,
    conflicts,
    installation,
    repositoryState,
    installable: repositoryState === "active" && ["fresh", "outdated"].includes(installation.state),
  };
}

function validateRequiredCheck(value) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "requiredCheck must contain one GitHub check name and publisher.");
  }
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const appSlug = typeof value.appSlug === "string" ? value.appSlug.trim().toLowerCase() : "";
  if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/u.test(name) || name === GUARD_CHECK_NAME) {
    throw new HttpError(400, `Required check name must be 1–100 visible characters and cannot be ${GUARD_CHECK_NAME}.`);
  }
  if (!/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/u.test(appSlug)) {
    throw new HttpError(400, "Required check publisher must be a valid GitHub App slug.");
  }
  return { name, appSlug };
}

function contentDigest(content) {
  return createHash("sha256").update(content).digest("hex");
}

function managedManifestFromHashes(managedVersion, managedHashes) {
  return `${JSON.stringify({
    schemaVersion: 1,
    managedVersion,
    managedFiles: managedHashes,
  }, null, 2)}\n`;
}

function managedManifestContent(managedFiles) {
  return managedManifestFromHashes(MANAGED_VERSION, Object.fromEntries(managedFiles.map(({ path: filePath, content }) => (
    [filePath, contentDigest(content)]
  ))));
}

function buildManagedFiles() {
  const workflow = `name: ChangePlane

on:
  pull_request_target:
    types: [opened, synchronize, reopened]
  pull_request_review:
    types: [submitted, dismissed]
  merge_group:
    types: [checks_requested]
  deployment_status:
  repository_dispatch:
    types: [changeplane_recheck]

permissions:
  checks: write
  pull-requests: write
  contents: read
  deployments: read
  statuses: read

concurrency:
  group: changeplane-pr-\${{ github.event.pull_request.number || github.event.client_payload.pullRequestNumber || github.event.merge_group.head_sha || github.event.deployment.sha || github.run_id }}
  cancel-in-progress: true

jobs:
  guard:
    name: ChangePlane guard
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
          ref: \${{ github.event.pull_request.base.sha || github.event.merge_group.base_sha || github.event.repository.default_branch }}
          persist-credentials: false
      - name: Read the trusted harness policy
        id: harness
        env:
          CHANGEPLANE_TRUSTED_POLICY: .changeplane.json
        run: node changeplane/src/lib/harness.js
      - name: Observe the exact revision
        if: steps.harness.outputs.mode == 'observe'
        uses: ./changeplane
        with:
          token: \${{ github.token }}
          mode: observe
      - name: Run the autonomous exact-revision harness
        if: steps.harness.outputs.mode == 'enforce'
        uses: ./changeplane
        with:
          token: \${{ github.token }}
          mode: enforce
          agent_dispatch: \${{ steps.harness.outputs.dispatch }}
          agent_webhook_url: https://changeplane.vercel.app/api/github?action=repair
          agent_webhook_token: \${{ secrets.CHANGEPLANE_CONTROLLER_HMAC }}
          controller_installation_id: \${{ secrets.CHANGEPLANE_CONTROLLER_INSTALLATION_ID }}
          max_remediation_attempts: \${{ steps.harness.outputs.max_attempts }}

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
          ref: \${{ github.event.pull_request.base.sha }}
          persist-credentials: false
      - name: Propose changed-line findings
        id: propose
        env:
          CHANGEPLANE_TRUSTED_POLICY: .changeplane.json
          GITHUB_TOKEN: \${{ github.token }}
          OPENAI_API_KEY: \${{ secrets.OPENAI_API_KEY }}
        run: node changeplane/examples/changeplane-review-run.js propose

  review_publish:
    name: Independent review receipt
    needs: review_propose
    if: always() && github.event_name == 'pull_request_target' && needs.review_propose.result == 'success'
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
          ref: \${{ github.event.pull_request.base.sha }}
          persist-credentials: false
      - name: Revalidate and publish the advisory Check
        id: publish
        env:
          CHANGEPLANE_REVIEW_JOB: \${{ needs.review_propose.outputs.review_job }}
          GITHUB_TOKEN: \${{ github.token }}
        run: node changeplane/examples/changeplane-review-run.js publish
`;
  return [
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
}

export function buildSetupFiles(requiredCheck = null, harnessMode = HARNESS_MODE.OBSERVE) {
  const managedFiles = buildManagedFiles();
  const harness = harnessPolicy({ mode: harnessMode });
  if (harness.mode === HARNESS_MODE.AUTONOMOUS && !requiredCheck) {
    throw new HttpError(400, "Autonomous mode requires one exact behavioral check and publisher.");
  }
  const policy = {
    version: 1,
    protectedPaths: {
      requireApproval: [".github/**", "changeplane/**", "infra/**", "migrations/**"],
      block: [".env", ".env.local"],
    },
    evidence: {
      requiredChecks: requiredCheck ? [validateRequiredCheck(requiredCheck)] : [],
      protectedPaths: [...DEFAULT_EVIDENCE_PROTECTED_PATHS],
      timeoutSeconds: requiredCheck ? 120 : 0,
    },
    review: {
      mode: "advisory",
      maxFindings: 5,
      memoryPath: ASSURANCE_MEMORY_PATH,
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
    { path: MANAGED_MANIFEST_PATH, content: managedManifestContent(managedFiles) },
    { path: POLICY_PATH, content: `${JSON.stringify(policy, null, 2)}\n` },
    { path: ASSURANCE_MEMORY_PATH, content: ASSURANCE_MEMORY_TEMPLATE },
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
  if (selectedHarness.mode === HARNESS_MODE.AUTONOMOUS) {
    const requiredChecks = policy?.evidence?.requiredChecks;
    if (!Array.isArray(requiredChecks) || requiredChecks.length === 0
      || requiredChecks.some((check) => !check || typeof check !== "object" || !check.name || !check.appSlug)) {
      throw new HttpError(409, "Autonomous repair requires at least one exact behavioral check and publisher.");
    }
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
    return manifest?.schemaVersion === 1
      && Number.isSafeInteger(manifest.managedVersion)
      && manifest.managedVersion > 0
      && manifest.managedFiles
      && typeof manifest.managedFiles === "object"
      && !Array.isArray(manifest.managedFiles)
      ? manifest
      : null;
  } catch {
    return null;
  }
}

export function classifyManagedInstallation({ files, reservedEntries = [] }) {
  if (!files || typeof files !== "object" || Array.isArray(files) || !Array.isArray(reservedEntries)) {
    throw new TypeError("Managed installation inspection is invalid.");
  }
  const desiredManagedFiles = buildManagedFiles();
  const desiredHashes = Object.fromEntries(desiredManagedFiles.map(({ path: filePath, content }) => (
    [filePath, contentDigest(content)]
  )));
  const allowedChangePlaneFiles = new Set([
    ...MANAGED_PATHS.filter((filePath) => filePath.startsWith("changeplane/")),
    MANAGED_MANIFEST_PATH,
  ]);
  const conflicts = reservedEntries
    .filter((entry) => typeof entry === "string" && entry.startsWith("changeplane/") && !allowedChangePlaneFiles.has(entry));

  if (typeof files[POLICY_PATH] !== "string") conflicts.push(POLICY_PATH);

  const manifest = files[MANAGED_MANIFEST_PATH];
  if (manifest == null) {
    const matchesCatalog = (catalog, { allowMissingOutsideCatalog = false } = {}) => (
      Object.entries(catalog).every(([filePath, digest]) => (
        typeof files[filePath] === "string" && contentDigest(files[filePath]) === digest
      ))
      && (allowMissingOutsideCatalog || MANAGED_PATHS.every((filePath) => (
        Object.hasOwn(catalog, filePath) || files[filePath] == null
      )))
    );
    const matchesLegacy = matchesCatalog(LEGACY_MANAGED_HASHES);
    const matchesCurrentWithoutManifest = matchesCatalog(desiredHashes, { allowMissingOutsideCatalog: true });
    if (!matchesLegacy && !matchesCurrentWithoutManifest) {
      for (const filePath of MANAGED_PATHS) {
        const content = files[filePath];
        if (content == null) continue;
        const digest = contentDigest(content);
        if (digest !== LEGACY_MANAGED_HASHES[filePath] && digest !== desiredHashes[filePath]) conflicts.push(filePath);
      }
      if (conflicts.length === 0) conflicts.push(MANAGED_MANIFEST_PATH);
    }
    const uniqueConflicts = [...new Set(conflicts)].sort();
    return uniqueConflicts.length === 0
      ? { state: "outdated", currentVersion: 0, targetVersion: MANAGED_VERSION, conflicts: [] }
      : { state: "conflict", currentVersion: null, targetVersion: MANAGED_VERSION, conflicts: uniqueConflicts };
  }

  const parsedManifest = parsedManagedManifest(manifest);
  const catalogHashes = parsedManifest?.managedVersion === MANAGED_VERSION
    ? desiredHashes
    : KNOWN_MANAGED_VERSION_HASHES[parsedManifest?.managedVersion];
  const expectedManifest = catalogHashes
    ? managedManifestFromHashes(parsedManifest.managedVersion, catalogHashes)
    : null;
  if (!parsedManifest || parsedManifest.managedVersion > MANAGED_VERSION || manifest !== expectedManifest) {
    conflicts.push(MANAGED_MANIFEST_PATH);
  }
  for (const filePath of Object.keys(catalogHashes ?? {})) {
    const content = files[filePath];
    if (typeof content !== "string" || contentDigest(content) !== catalogHashes[filePath]) {
      conflicts.push(filePath);
    }
  }
  const uniqueConflicts = [...new Set(conflicts)].sort();
  if (uniqueConflicts.length > 0) {
    return { state: "conflict", currentVersion: null, targetVersion: MANAGED_VERSION, conflicts: uniqueConflicts };
  }
  return parsedManifest.managedVersion === MANAGED_VERSION
    ? { state: "current", currentVersion: MANAGED_VERSION, targetVersion: MANAGED_VERSION, conflicts: [] }
    : { state: "outdated", currentVersion: parsedManifest.managedVersion, targetVersion: MANAGED_VERSION, conflicts: [] };
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
  return classifyManagedInstallation({ files, reservedEntries });
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
} = {}) {
  if (!Number.isSafeInteger(pullRequest?.number) || typeof pullRequest?.html_url !== "string") {
    throw new Error("GitHub returned an invalid setup pull request.");
  }
  return {
    repository: repo.full_name,
    branch,
    operation,
    harnessMode,
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
  const plan = { goal: `Install the ChangePlane ${mode} harness`, scope: [...new Set(scope)], harnessMode: mode };
  if (requiredCheck) plan.requiredCheck = validateRequiredCheck(requiredCheck);
  return plan;
}

function readObserveSetupPlan(body, files) {
  const match = String(body ?? "").match(/^<!-- changeplane ([^\n]+) -->/u);
  if (!match) return null;
  try {
    const plan = JSON.parse(match[1]);
    const requiredCheck = validateRequiredCheck(plan?.requiredCheck);
    const harnessMode = harnessPolicy({ mode: plan?.harnessMode }).mode;
    const expected = observeSetupPlan(files, requiredCheck, harnessMode);
    return JSON.stringify(plan) === JSON.stringify(expected) ? { plan, requiredCheck, harnessMode } : null;
  } catch {
    return null;
  }
}

function observeUpgradePlan(files) {
  return {
    goal: `Upgrade ChangePlane managed files to version ${MANAGED_VERSION}`,
    scope: files.map(({ path: filePath }) => filePath),
    managedVersion: MANAGED_VERSION,
  };
}

function readObserveUpgradePlan(body, files) {
  const match = String(body ?? "").match(/^<!-- changeplane ([^\n]+) -->/u);
  if (!match) return null;
  try {
    const plan = JSON.parse(match[1]);
    const expected = observeUpgradePlan(files);
    return JSON.stringify(plan) === JSON.stringify(expected) ? plan : null;
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
    const parsed = readObserveSetupPlan(pullRequest?.body, files);
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

async function findObserveUpgradePullRequest(encodedRepository, repo, token, files) {
  const owner = repo.full_name.split("/")[0];
  const pulls = await github(
    `/repos/${encodedRepository}/pulls?state=open&base=${encodeURIComponent(repo.default_branch)}&head=${encodeURIComponent(`${owner}:${OBSERVE_UPGRADE_BRANCH}`)}&per_page=10`,
    token,
  );
  if (!Array.isArray(pulls)) throw new Error("GitHub returned an invalid upgrade pull-request list.");
  const matches = pulls.filter((pullRequest) => (
    pullRequest?.state === "open"
      && pullRequest.head?.ref === OBSERVE_UPGRADE_BRANCH
      && pullRequest.head?.repo?.full_name?.toLowerCase() === repo.full_name.toLowerCase()
      && pullRequest.base?.ref === repo.default_branch
      && pullRequest.title === "chore: upgrade ChangePlane managed setup"
      && readObserveUpgradePlan(pullRequest?.body, files)
  ));
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
    const blobSha = createHash("sha1").update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest("hex");
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

async function validateObserveUpgradePullRequest(encodedRepository, pullRequest, baseSha, files, expectedStatuses, token) {
  if (files.some(({ path: filePath }) => filePath === POLICY_PATH)) {
    throw new Error("ChangePlane policy cannot be part of a managed upgrade.");
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
    const blobSha = createHash("sha1").update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest("hex");
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

async function managedUpgradeFiles(encodedRepository, baseSha, token) {
  const desired = buildSetupFiles().filter(({ path: filePath }) => (
    filePath === MANAGED_MANIFEST_PATH || MANAGED_PATHS.includes(filePath)
  ));
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
  return { files, expectedStatuses };
}

async function createObserveUpgradePullRequest(target, session) {
  const { encodedRepository, repo, baseSha } = target;
  const token = session.token;
  const { files, expectedStatuses } = await managedUpgradeFiles(encodedRepository, baseSha, token);
  if (files.length === 0 || files.some(({ path: filePath }) => filePath === POLICY_PATH)) {
    throw new HttpError(409, "ChangePlane managed files are already current or cannot be upgraded safely.");
  }
  const existingPullRequest = await findObserveUpgradePullRequest(encodedRepository, repo, token, files);
  if (existingPullRequest) {
    await validateObserveUpgradePullRequest(encodedRepository, existingPullRequest, baseSha, files, expectedStatuses, token);
    return observeSetupResult(repo, existingPullRequest, { branch: OBSERVE_UPGRADE_BRANCH, operation: "upgrade" });
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

  const plan = observeUpgradePlan(files);
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
          `This updates only ${files.length} pristine ChangePlane-managed file${files.length === 1 ? "" : "s"} to managed version ${MANAGED_VERSION}.`,
          "",
          `The repository-owned \`${POLICY_PATH}\` policy is not changed. No default-branch write occurs until this pull request is reviewed and merged.`,
          "",
          "Closing this pull request stops the upgrade.",
        ].join("\n"),
      },
    });
    await validateObserveUpgradePullRequest(encodedRepository, pullRequest, baseSha, files, expectedStatuses, token);
    return observeSetupResult(repo, pullRequest, { branch: OBSERVE_UPGRADE_BRANCH, operation: "upgrade" });
  } catch (error) {
    if (error instanceof GitHubError && error.status === 422) {
      const pullRequest = await findObserveUpgradePullRequest(encodedRepository, repo, token, files);
      if (pullRequest) {
        await validateObserveUpgradePullRequest(encodedRepository, pullRequest, baseSha, files, expectedStatuses, token);
        return observeSetupResult(repo, pullRequest, { branch: OBSERVE_UPGRADE_BRANCH, operation: "upgrade" });
      }
    }
    throw error;
  }
}

async function createObservePullRequest(repository, session, requiredCheck = null, harnessMode = HARNESS_MODE.OBSERVE) {
  const selectedHarness = harnessPolicy({ mode: harnessMode });
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
  if (installation.state === "outdated") return createObserveUpgradePullRequest(target, session);
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
          `## ChangePlane ${selectedHarness.mode} setup`,
          "",
          selectedHarness.mode === HARNESS_MODE.AUTONOMOUS
            ? "This installs the exact-revision harness. Fixable failed evidence may receive at most two bounded repair attempts within 15 minutes; protected, ambiguous, stale, or exhausted changes stop for a human."
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
  const controlledCanary = rolloutMode() === "controlled_canary";
  const canaryRepository = controlledCanary ? configuredCanaryRepository() : null;
  if (controlledCanary && process.env.CHANGEPLANE_CANARY_REPOSITORY && !canaryRepository) {
    throw new HttpError(503, "CHANGEPLANE_CANARY_REPOSITORY must contain one repository in owner/repository form. No GitHub request was made.");
  }
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
      .filter((repo) => !canaryRepository || repo?.full_name?.toLowerCase() === canaryRepository.toLowerCase())
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

async function readRepositoryRuntime(encodedRepository, repo, token) {
  if (typeof repo.default_branch !== "string" || !repo.default_branch) {
    throw new HttpError(409, "Repository has no default branch.");
  }
  const ref = await github(`/repos/${encodedRepository}/git/ref/heads/${encodeRef(repo.default_branch)}`, token);
  const baseSha = ref?.object?.sha;
  if (!/^[a-f0-9]{40}$/u.test(baseSha ?? "")) throw new Error("GitHub returned an invalid default-branch revision.");
  const content = await readRepositoryFile(encodedRepository, POLICY_PATH, baseSha, token);
  if (typeof content !== "string") {
    return {
      baseSha,
      content: null,
      model: DEFAULT_PROPOSAL_MODEL,
      configured: false,
      harness: harnessPolicy(),
    };
  }
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
  return { baseSha, content, model, configured, harness };
}

async function validateRuntimePullRequest(encodedRepository, pullRequest, baseSha, headSha, treeSha, token) {
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
  if (comparison?.ahead_by !== 1 || comparison?.behind_by !== 0 || comparison?.total_commits !== 1
    || !Array.isArray(comparison?.files) || comparison.files.length !== 1
    || comparison.files[0]?.filename !== POLICY_PATH) {
    throw new HttpError(409, `The runtime configuration pull request must change only ${POLICY_PATH}.`);
  }
}

async function createRuntimePullRequest(repository, session, model, harnessMode) {
  const { encodedRepository, repo } = await requireWritableRepository(repository, session);
  const runtime = await readRepositoryRuntime(encodedRepository, repo, session.token);
  if (!runtime.content) throw new HttpError(409, "Merge the ChangePlane setup pull request before choosing a proposal model.");
  const selectedModel = validateRuntimeModel(model ?? runtime.model);
  const selectedHarness = harnessPolicy({ mode: harnessMode ?? runtime.harness.mode });
  if (selectedHarness.mode === HARNESS_MODE.AUTONOMOUS) await prepareAutonomousHarness(repository, session);
  const updatedPolicy = buildRuntimePolicy(runtime.content, selectedModel, selectedHarness.mode);
  if (updatedPolicy === runtime.content) {
    return {
      repository,
      operation: "current",
      model: selectedModel,
      harnessMode: selectedHarness.mode,
      state: "current",
    };
  }
  const changesModel = selectedModel !== runtime.model;
  const changesHarness = selectedHarness.mode !== runtime.harness.mode;
  const changeLabel = changesModel && changesHarness
    ? `${selectedModel} and ${selectedHarness.mode} mode`
    : changesHarness ? `${selectedHarness.mode} harness mode` : selectedModel;

  const baseCommit = await github(`/repos/${encodedRepository}/git/commits/${runtime.baseSha}`, session.token);
  const baseTree = baseCommit?.tree?.sha;
  if (!/^[a-f0-9]{40}$/u.test(baseTree ?? "")) throw new Error("GitHub returned an invalid default-branch tree.");
  const blob = await github(`/repos/${encodedRepository}/git/blobs`, session.token, {
    method: "POST",
    body: { content: updatedPolicy, encoding: "utf-8" },
  });
  const tree = await github(`/repos/${encodedRepository}/git/trees`, session.token, {
    method: "POST",
    body: {
      base_tree: baseTree,
      tree: [{ path: POLICY_PATH, mode: "100644", type: "blob", sha: blob.sha }],
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
          "## ChangePlane runtime policy",
          "",
          `This changes only \`${POLICY_PATH}\` and selects \`${selectedModel}\` with the \`${selectedHarness.mode}\` exact-revision harness.`,
          "",
          selectedHarness.mode === HARNESS_MODE.AUTONOMOUS
            ? "Fixable failed evidence may receive at most two attempts within 15 minutes. The model still receives no forge write, Check, approval, or merge authority."
            : "Observe mode publishes a neutral exact-revision receipt and does not dispatch repair.",
          "",
          "Closing this pull request keeps the current runtime unchanged.",
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
  await validateRuntimePullRequest(encodedRepository, pullRequest, runtime.baseSha, headSha, tree.sha, session.token);
  return {
    repository,
    branch: RUNTIME_CONFIG_BRANCH,
    operation: "runtime",
    model: selectedModel,
    harnessMode: selectedHarness.mode,
    state: "pending",
    pullRequest: { number: pullRequest.number, url: pullRequest.html_url, state: pullRequest.state },
  };
}

async function runtimeStatus(req, res) {
  const session = requireSession(req);
  const repository = validateRepository(queryValue(req, "repository"));
  const { encodedRepository, repo, installationId } = await requireWritableRepository(repository, session);
  const runtime = await readRepositoryRuntime(encodedRepository, repo, session.token);
  const canWriteSecrets = await installationCanWriteSecrets(session, installationId);
  const byok = !canWriteSecrets
    ? { configured: false, state: "permission_required", secretName: BYOK_SECRET_NAME, updatedAt: null }
    : await readByokStatus(repository, await repositoryByokToken(session, repo, installationId));
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
  sendJson(res, 200, {
    repository,
    provider: RUNTIME_PROVIDER,
    model: runtime.model,
    activeModel: runtime.model,
    modelConfigured: runtime.configured,
    effort: PROPOSAL_REASONING_EFFORT,
    harness: {
      mode: runtime.harness.mode,
      autonomousAvailable: controller.configured && session.authMode === "github_app" && canWriteSecrets,
      ready: runtime.harness.mode === HARNESS_MODE.AUTONOMOUS && byok.configured && controller.configured,
      maxAttempts: HARNESS_MAX_ATTEMPTS,
      budgetMinutes: HARNESS_BUDGET_MINUTES,
    },
    managed,
    byok,
  });
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
  const { encodedRepository, repo, installationId } = await requireWritableRepository(repository, session);
  if (!await installationCanWriteSecrets(session, installationId)) {
    throw new HttpError(403, "The GitHub App installation needs Actions Secrets write permission before BYOK can be configured. No provider request was made.");
  }
  const runtime = await readRepositoryRuntime(encodedRepository, repo, session.token);
  await verifyOpenAIKey(apiKey, { model: runtime.model });
  const byokToken = await repositoryByokToken(session, repo, installationId);
  const publicKey = await repositoryActionsPublicKey(encodedRepository, byokToken);
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
  const { encodedRepository, repo, installationId } = await requireWritableRepository(repository, session);
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
  let evidenceOptions = [];
  let evidenceDiscovery = { state: "unavailable" };
  if (target.installation.state === "fresh") {
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
      const seen = new Set();
      const evidenceScore = (name) => {
        if (/\b(e2e|integration|unit|tests?|ci)\b/iu.test(name)) return 2;
        if (/\b(build|typecheck)\b/iu.test(name)) return 1;
        return 0;
      };
      evidenceOptions = payloads.flatMap((payload) => Array.isArray(payload?.check_runs) ? payload.check_runs : [])
        .filter((check) => typeof check?.name === "string" && check.name.length > 0 && check.name.length <= 100
          && check.name !== GUARD_CHECK_NAME && typeof check?.app?.slug === "string" && check.app.slug.length > 0)
        .filter((check) => {
          const key = `${check.name}\0${check.app.slug}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((check) => ({ check, score: evidenceScore(check.name) }))
        .sort((left, right) => right.score - left.score || left.check.name.localeCompare(right.check.name))
        .slice(0, 8)
        .map(({ check, score }, index) => ({
          name: check.name,
          appSlug: check.app.slug,
          suggested: score > 0 && index === 0,
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
    const upgrade = await managedUpgradeFiles(target.encodedRepository, target.baseSha, session.token);
    files = upgrade.files;
    const existingPullRequest = await findObserveUpgradePullRequest(target.encodedRepository, target.repo, session.token, files);
    if (existingPullRequest) {
      try {
        await validateObserveUpgradePullRequest(
          target.encodedRepository,
          existingPullRequest,
          target.baseSha,
          files,
          upgrade.expectedStatuses,
          session.token,
        );
        setup = {
          state: "pending",
          operation: "upgrade",
          pullRequest: { number: existingPullRequest.number, url: existingPullRequest.html_url },
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
      setup = { state: "upgrade_available", operation: "upgrade" };
    }
  } else if (target.installation.state === "current") {
    setup = { state: "current", managedVersion: MANAGED_VERSION };
  } else if (target.installation.state === "conflict") {
    setup = {
      state: "conflict",
      message: `ChangePlane will not overwrite repository-owned or modified paths: ${target.conflicts.join(", ")}`,
    };
  }
  sendJson(res, 200, {
    repository: target.repo.full_name,
    defaultBranch: target.repo.default_branch,
    repositoryState: target.repositoryState,
    installation: target.installation,
    installable,
    conflicts: target.conflicts,
    setupFiles: files.length,
    setup,
    evidenceOptions,
    evidenceDiscovery,
    harness: {
      autonomousAvailable: repairControllerConfiguration().configured,
      maxAttempts: HARNESS_MAX_ATTEMPTS,
      budgetMinutes: HARNESS_BUDGET_MINUTES,
    },
    capabilities: {
      independentReview: true,
      agentHandback: true,
      assuranceMemory: true,
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

async function prepareAutonomousHarness(repository, session) {
  const configuration = repairControllerConfiguration();
  if (!configuration.configured) {
    throw new HttpError(503, "Autonomous repair is temporarily unavailable. Observe mode remains available.");
  }
  const { encodedRepository, repo, installationId } = await requireWritableRepository(repository, session);
  if (session.authMode !== "github_app" || !Number.isSafeInteger(repo?.id) || repo.id < 1
    || !/^[1-9][0-9]{0,19}$/u.test(String(installationId ?? ""))) {
    throw new HttpError(409, "Autonomous repair requires the repository-scoped ChangePlane GitHub App.");
  }
  if (!await installationCanWriteSecrets(session, installationId)) {
    throw new HttpError(403, "The GitHub App installation needs Actions Secrets write permission before autonomous repair can be enabled.");
  }
  const token = await repositoryByokToken(session, repo, installationId);
  const byok = await readByokStatus(repository, token);
  if (!byok.configured) {
    throw new HttpError(409, "Add an OpenAI key before enabling autonomous repair.");
  }

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
      repositoryId: repo.id,
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
  for (const [name, value] of [
    [HARNESS_SECRETS.controller, controllerSecret],
    [HARNESS_SECRETS.installation, String(installationId)],
    [HARNESS_SECRETS.generation, String(configuration.generation)],
    [HARNESS_SECRETS.publicKeys, publicKeys],
  ]) {
    await putRepositoryActionsSecret(encodedRepository, token, publicKey, name, value);
  }
  await putRepositoryActionsSecret(
    encodedRepository,
    token,
    publicKey,
    HARNESS_SECRETS.enabled,
    "true",
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
  const requiredCheck = validateRequiredCheck(body.requiredCheck);
  const harnessMode = harnessPolicy({ mode: body.harnessMode }).mode;
  if (harnessMode === HARNESS_MODE.AUTONOMOUS) {
    if (!requiredCheck) throw new HttpError(400, "Autonomous repair requires one exact behavioral check and publisher.");
    await prepareAutonomousHarness(repository, session);
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

export default async function handler(req, res) {
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
    if ((action === "install" || action === "runtime" || action === "byok" || action === "repair" || action === "repair-claim"
      || action === "repair-push-token" || action === "repair-validate") && (method === "POST" || method === "DELETE")) {
      assertMutationSourceProvenance();
    }
    if (method === "GET" && action === "readiness") {
      const state = readiness();
      sendJson(res, state.ready ? 200 : 503, {
        status: state.ready ? "ready" : "configuration_required",
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
    if (method === "GET" && action === "session") {
      const session = readSession(req);
      const configured = oauthIsConfigured() && hasSourceProvenance();
      const mode = rolloutMode();
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
      });
      return;
    }
    if (method === "GET" && action === "login") return await login(req, res);
    if (method === "GET" && action === "authorize") return await authorizeExisting(req, res);
    if (method === "GET" && action === "installation") return await installation(req, res);
    if (method === "GET" && action === "callback") return await callback(req, res);
    if (method === "GET" && action === "repos") return await repositories(req, res);
    if (method === "GET" && action === "preflight") return await preflight(req, res);
    if (method === "GET" && action === "runtime") return await runtimeStatus(req, res);
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
    const status = error instanceof HttpError
      ? error.status
      : error instanceof GitHubError && error.status >= 400 && error.status < 500
        ? error.status
        : 500;
    const message = error instanceof HttpError
      ? error.message
      : error instanceof GitHubError
        ? `GitHub request failed (${error.status}).${error.requestId ? ` GitHub request ${error.requestId}.` : ""}`
        : "GitHub connection failed.";
    if (error instanceof GitHubError && error.retryDelayMs > SERVERLESS_MAX_RETRY_DELAY_MS) {
      res.setHeader("retry-after", String(Math.ceil(error.retryDelayMs / 1000)));
    }
    sendJson(res, status, { error: message, requestId });
    logApiRequest(status >= 500 ? "error" : "warn", {
      event: "request_failed",
      requestId,
      action: typeof action === "string" ? action.slice(0, 32) : "unknown",
      method,
      status,
      durationMs: Date.now() - startedAt,
      errorType: error?.constructor?.name || "UnknownError",
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
