# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

- **Language**: Tamil/English mixed. Reply in same style.
- **APK build rule**: NEVER build APK without explicit "OK" from user.
- **Problem-solving rule (CRITICAL)**: When user reports problems:
  1. STOP — do not touch code immediately.
  2. LIST all problems the user mentioned, ask for confirmation.
  3. ANALYZE root cause for each (which file, why) BEFORE coding.
  4. SHARE plan, wait for user OK.
  5. Fix ALL problems together in one build — not one at a time.
  Past failure: jumping to code on partial info wastes 15+ hrs and burns user trust.
- **User device**: Honor (HMOS). Test only on real device, not emulator.
- **Repo**: nnvvmm663-sketch/my-girls-1 (private). Build via GitHub Actions `build-apk.yml`.

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
