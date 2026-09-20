# Third-party notices

ChangePlane uses third-party packages under their respective licenses. The authoritative license texts are distributed with the installed packages and upstream repositories.

| Package | Use | License |
| --- | --- | --- |
| React / React DOM | Product UI | MIT |
| Phosphor Icons for React | Interface icons | MIT |
| Vite and `@vitejs/plugin-react` | Build and development tooling | MIT |
| libsodium-wrappers | GitHub Actions Secret sealed-box encryption | ISC |
| pg (node-postgres) | Hosted PostgreSQL connectivity | MIT |
| Playwright Test | End-to-end verification | Apache-2.0 |
| `@modelcontextprotocol/sdk` | Authenticated remote MCP transport; adapted stateless HTTP example | MIT |
| Zod | Remote MCP tool input validation | MIT |

The deep-teal paper texture under `src/assets` is a ChangePlane project asset. The product does not ship third-party logos, music, customer screenshots, map imagery, or production RouteThai data.

The standalone Open Source bundle uses Node.js built-ins and first-party evaluator files. It does not bundle the frontend, PostgreSQL client, libsodium, Playwright or npm dependencies. The complete source repository's Apache-2.0 license does not relicense third-party packages. Preserve their installed license texts when redistributing them.

The optional OpenCodeReview adapter interoperates with the `ocr.run-manifest/v1` JSON contract inspected at [alibaba/open-code-review, commit a003b9341a65130b024829101ea35494b56569e1](https://github.com/alibaba/open-code-review/tree/a003b9341a65130b024829101ea35494b56569e1), licensed under Apache-2.0, copyright 2026 alibaba/open-code-review Contributors. ChangePlane's adapter and synthetic protocol tests are original interoperability code; the bundle contains no OCR source, binary, prompts or dependencies. Operators install that engine separately and must preserve its license and applicable notices if redistributing it. Use of its name identifies compatibility, not affiliation or endorsement.

RouteThai is referenced with the project owner's stated authorization as a real production use case and as the source of a sanitized public replay. This reference does not claim a third-party customer endorsement, and the product ships no private RouteThai repository content or operational data.
