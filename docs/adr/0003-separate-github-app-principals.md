# Separate GitHub App principals by authority

ChangePlane will use separate GitHub App principals for installation, Guard publication, and Autonomous repair because differently scoped runtime tokens from one root private key do not provide the independent authority boundary expected of the product. Installer and Guard principals must be separated before a paid design partner is onboarded; the repair principal remains absent until Autonomous is separately activated and live-canary proven.

## Consequences

Each principal has its own private key, installation identity, minimum permissions, rotation procedure, audit identity, readiness check, and containment path. The Guard principal may write Checks but cannot provision workflows, secrets, or repository contents. The repair principal may apply an accepted bounded patch but cannot publish the Guard or alter installation policy.
