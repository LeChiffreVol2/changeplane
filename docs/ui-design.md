# Product interface and design QA

The interface uses React and ordinary CSS. `src/tokens.css` defines shared design roles; `src/styles.css` applies them. There is no Tailwind dependency or build step.

## Design contract

- Preserve `Keep GitHub. Let agents ship.`, the deep-teal textured frame and warm off-white surface.
- Use the shared type roles: metadata 12 px, body and controls 14 px, section headings 16 px, subtitles 20 px, drawer titles 24 px and display headings 28 px at the default root size. The landing hero has its own responsive display scale. Use rem units so supporting text follows the user's text size.
- Use regular, medium and strong weights (400, 500 and 600), the system sans-serif stack for interface text and monospace for revisions, paths and machine-readable evidence.
- Use spacing tokens for layout rhythm. Keep explicit dimensions for geometry such as icons, connecting lines and table columns.
- Use the existing primary, secondary and icon controls. Primary and secondary actions share typography, padding, radius, focus treatment and hover behavior. Primary, secondary and standalone icon controls are at least 44 px high on narrow screens; standalone icon controls are 36 px on desktop.
- Use `Drawer` for Settings, file details, assurance workflow, evidence, agent handback and repair boundaries. Keep the heading and footer visible while the body scrolls. Preserve focus containment, Escape dismissal and focus restoration.
- Lead a workspace with the change, its consequence and one next action. Use functional headings. Keep authority roles, machine payloads and optional repair steps in disclosures; open repair progress while it is running.
- Name actions for their actual result. “Copy handback” copies the payload; “Open PR assessment guide” opens documentation. Settings are explicitly local drafts that reset on refresh, for both Individual and Teams.
- Keep synthetic example disclosures visible. No visual state expands repository permissions, connects an account, publishes PASS or grants merge authority.

## Verification — 2026-09-10

The Chromium regression covers 320 × 640, 390 × 844 and 1280 × 900 viewports. It checks header and repository-context separation, queue status/time spacing, readable checkpoint labels, document overflow, visible drawer actions and a single-line handback action. The Settings drawer is also checked with 200% root text size after its entrance animation completes, including overflow within its scrollable body.

Manual visual inspection covers the entry page, Individual and Teams Settings, setup, workspace and handback. Review only the public synthetic data. Screenshots under ignored `output/` are local review evidence, not production repository screenshots or release assets.

The full onboarding suite also checks repository selection, permission boundaries, protected setup and upgrade flows, exact-revision evidence, independent settings drafts and keyboard focus during delayed authentication. These checks are targeted regression coverage, not a claim of complete WCAG conformance or universal browser support.

Before releasing a UI change, run `npm run verify`, `npm run test:e2e` and `npm run audit:prod`, then smoke the signed-out production deployment. Use the protected `CI / verify` check and deploy from the resulting main commit. Routine UI fixes keep the existing public release version and are identified by commit SHA.
