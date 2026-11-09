# Project Notes

## Tech Stack
- Nuxt 4 (`nuxt` ^4.5.2) with Nuxt UI v4 (`@nuxt/ui` ^4.11.0) and Tailwind CSS v4.
- Netlify Nitro server preset is used by default when `npm run build` runs on Netlify (or add `preset: 'netlify'` to `nuxt.config.ts`).
- MongoDB via Mongoose (`mongoose` ^9.9.4).
- pnpm is the configured package manager (`packageManager` in `package.json`).

## Commands
- `pnpm install` — install dependencies.
- `pnpm dev` — start the development server at `http://localhost:3000`.
- `pnpm build` — build for production.
- `pnpm preview` — preview the production build locally.
- `pnpm lint` — run ESLint.
- `pnpm typecheck` — run Vue/Nuxt type checking.
- `pnpm test` — run Vitest unit and mocked route/workflow tests; these do not use live MongoDB or Submittable.
- Verification baseline on 2026-11-03: tests, lint, typecheck, and the default local production build pass. The build may emit non-fatal font-network/tooling warnings. Local builds use the Node server preset unless a deployment preset is selected; verify Netlify background functions separately.
- CI runs lint, typecheck, tests, and a production build on pushes and pull requests.

## Environment Variables
Copy `.env.example` to `.env` and fill in values. Runtime config keys must be prefixed with `NUXT_` to be available in Nitro server routes. Public keys need to be prefixed with `NUXT_PUBLIC_` for client access.

## Code Conventions
- Use TypeScript. Keep `.vue` components in `app/components/` and pages in `app/pages/`.
- Server API routes live in `server/api/` and server utils in `server/utils/`.
- Use Nuxt UI components (`UButton`, `UInput`, `UTable`, etc.) for UI.
- Avoid adding secrets or `.env` files to git (`.env` and `.env.*` are ignored, except `.env.example`).

## Domain Notes
- Admission rounds live on `Application.rounds` (not Cycle). `resolveSubmissionRound` is fed per-application rounds in `routingRun.ts` and `reviewCompletionRefresh.ts`. A boot-time migration (`server/utils/migrateRounds.ts`, run from `server/plugins/db.ts`) copies legacy `cycle.rounds` data onto applications and unsets it.
- Submittable re-issues `reviewStageId` when a stage is modified. `metadata_sync` runs `applyStageReconcile` (`server/utils/stageReconcile.ts`) which remaps unambiguous old→new stageIds in place across ReviewStage, Review, Submission.currentStageId, `routing`/`routingDraft` configs, and dashboard metrics; ambiguous/orphan cases land in the job result. Routing configs must never be replaced — stageId references are rewritten via `rewriteReferencedStageIds` in `routingConfig.ts`. `routingHistory` is intentionally not rewritten.
- `routing` is the published config; `routingDraft` is the working copy written by the stage PATCH endpoint and promoted by `routing-publish`.
- Daily job chains are configured at `/jobs/scheduler`. `tickJobSchedules` runs from both Netlify dispatch and the local worker, snapshots the active cycle per occurrence, and serializes scheduled runs per cycle using `ScheduleCycle.runId`. Manual jobs are not globally excluded.
- Scheduled automatic refresh jobs start in `waiting` with `dependencyOf`; the scheduler releases them only after the root job settles. Preserve `scheduleRunId`, `scheduleStep`, `executionKey`, and `workerSettled` semantics when changing job lifecycle logic. Failed/interrupted scheduled routing or essay actions hold the cycle for explicit operator review rather than replaying automatically.

## Workflow
- Do not start development on the next feature unless explicit permission is given.
- Before implementing any code, provide an implementation plan for review and wait for approval.
