// Public, synthetic onboarding data. Never a connected Customer Account.
export const SESSION_KEY = "changeplane.preview-session.v3";
export const PRESENTATION_USER = {
  name: "Alex Morgan",
  handle: "alex-example",
  email: "alex@example.invalid",
  organization: "Example Engineering",
  role: "Platform Engineering",
  initials: "AM",
  isPreview: true,
};

export const PREVIEW_REPOSITORIES = [
  {
    fullName: "routethai-shadow/synthetic-routing",
    private: true,
    defaultBranch: "main",
    permissions: { push: true, admin: false },
  },
];

export const PREVIEW_PREFLIGHT = {
  repositoryState: "active",
  installable: true,
  conflicts: [],
  setupFiles: 9,
  setupProfile: "verify-lite",
  payloadProfiles: {
    verifyLite: { managedProfile: "verify-lite", files: 9, repairAuthority: false, providerKeyRequired: false },
    autonomous: { managedProfile: "full", files: 21, repairAuthority: true, providerKeyRequired: true },
  },
  evidenceOptions: [{
    name: "test",
    appSlug: "github-actions",
    workflowPath: ".github/workflows/ci.yml",
    suggested: true,
  }],
  harness: { verifyAvailable: true, autonomousAvailable: true, maxAttempts: 2, budgetMinutes: 15 },
  capabilities: {
    independentReview: false,
    agentHandback: true,
    assuranceMemory: false,
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
};
