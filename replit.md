# My Dream Girles

Tamil AI Chat app — Android APK with Render backend and 13 Gemini keys.

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

- Render server: `my-girls-1-5.onrender.com` (latest active service)
- GitHub repo: `nnvvmm663-sketch/my-dream-girle`
- APK build: `.github/workflows/build-apk.yml` via GitHub Actions
- 13 Gemini keys stored on Render

## Architecture

```
Android APK
    ↓
my-girls-1-5.onrender.com (Render Server)
    ↓
13 Gemini Keys (stored on Render)
```

Replit is used ONLY for: code editing, GitHub push, new APK builds.
Replit has NO connection to the live app.

## Product

Tamil AI Chat Android app ("My Dream Girles") with multiple girl characters powered by Gemini AI, served via Render backend.

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
- **Repo**: `nnvvmm663-sketch/my-dream-girle`. Build via GitHub Actions `build-apk.yml`.

## Gotchas

- Do NOT trigger APK build without user's explicit OK.
- Render service `my-girls-1-5` is the active server (srv-d83asc9kh4rs73adpq3g).
- 5 Render services exist (my-girls-1 through my-girls-1-5), latest is -5.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
