---
name: Render database schema provisioning
description: Production behavior when new Drizzle tables are added to this Render-hosted API.
---

New Drizzle table definitions are not applied to the Render PostgreSQL database by the normal Render build. New database-backed routes need an explicit idempotent schema setup or a separate migration step before querying their tables.

**Why:** The API build can succeed while production requests fail because `render-build.sh` installs and bundles the server but does not run the database schema push.

**How to apply:** For new Render database tables, verify production schema provisioning as part of the feature before declaring the route live.