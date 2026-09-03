const RULES = Object.freeze([
  Object.freeze({
    id: "same_sha_generation",
    pattern: /rerun[^\n]{0,160}(?:requires?|push)[^\n]{0,40}new commit/iu,
    message: "A newer Evaluation Generation may re-evaluate the same SHA and must not inherit prior PASS.",
  }),
  Object.freeze({
    id: "strict_head_availability",
    pattern: /reports?[^\n]{0,40}\bmerge_queue_required\b/iu,
    message: "A complete no-queue gate is Strict Head; Merge Queue is required only for Queue Certified.",
  }),
  Object.freeze({
    id: "deployed_release_boundary",
    pattern: /(?:(?:managed[\s-]+v13|v13[^\n]{0,80}(?:release|candidate|publisher))[^\n]{0,320}(?:not (?:the )?(?:currently )?deployed|canary remains pending)|dedicated-App guard lifecycle[^\n]{0,320}not been deployed)/iu,
    message: "The managed-v13 baseline is deployed and protected-canary proven; describe later candidate changes and unproven gates separately.",
  }),
]);

export function auditReleaseClaims(files) {
  if (!Array.isArray(files)) throw new TypeError("Release claim files must be an array.");
  const findings = [];
  for (const file of files) {
    if (typeof file?.path !== "string" || typeof file?.content !== "string") {
      throw new TypeError("Release claim file input is invalid.");
    }
    const lines = file.content.split(/\r?\n/u);
    for (let index = 0; index < lines.length; index += 1) {
      for (const rule of RULES) {
        if (rule.pattern.test(lines[index])) {
          findings.push({
            path: file.path,
            line: index + 1,
            rule: rule.id,
            message: rule.message,
          });
        }
      }
    }
  }
  return findings;
}
