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
- `pnpm lint` — run ESLint. Note: the repo currently has many pre-existing lint errors/warnings (e.g. `server/utils/legacyFieldMap.ts` quote style); it does not pass cleanly.
- `pnpm typecheck` — run Vue/Nuxt type checking. Note: currently fails with pre-existing errors (mostly `server/utils/hspt.ts`); verify your changed files are clean rather than expecting a clean run.

## Environment Variables
Copy `.env.example` to `.env` and fill in values. Runtime config keys must be prefixed with `NUXT_` to be available in Nitro server routes. Public keys need to be prefixed with `NUXT_PUBLIC_` for client access.

## Code Conventions
- Use TypeScript. Keep `.vue` components in `app/components/` and pages in `app/pages/`.
- Server API routes live in `server/api/` and server utils in `server/utils/`.
- Use Nuxt UI components (`UButton`, `UInput`, `UTable`, etc.) for UI.
- Avoid adding secrets or `.env` files to git (`.env` and `.env.*` are ignored, except `.env.example`).

## Workflow
- Do not start development on the next feature unless explicit permission is given.
- Before implementing any code, provide an implementation plan for review and wait for approval.
