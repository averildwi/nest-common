# Monorepo / Turborepo support

This document is the contract for how `@averildwi/nest-common` resolves the
project it should configure, and how it installs dependencies and runs scripts
in a workspace.

## Goal

`npx @averildwi/nest-common` must work when it is started from either:

- the NestJS application directory (`apps/api`, `apps/backend`), or
- the workspace root (the folder that contains `turbo.json`,
  `pnpm-workspace.yaml`, `lerna.json`, or a `package.json` with `workspaces`).

It must never silently configure the wrong package and must never run a bare
`npm install` inside a workspace package.

## UX contract

```
npx @averildwi/nest-common [--cwd <path>] [--app <name|path>] [--pm <name>]
                           [--swagger|--no-swagger] [--no-install] [--no-lint] [--yes]
```

| Situation | Behaviour |
| --- | --- |
| Single-package repo, run from the project root | Same as before |
| Run from a NestJS app inside a workspace | App is used; PM and lockfile come from the workspace root |
| Run from the workspace root with exactly one NestJS app | That app is selected and shown in the banner |
| Run from the workspace root with several NestJS apps | Interactive list prompt; without a TTY it exits with code 2 and prints `--app` |
| Run from the workspace root with no NestJS app | Clean error listing the scanned workspace packages |
| Run from a non-NestJS workspace member (`packages/ui`) | Clean error listing the NestJS candidates; no silent jump |
| The workspace root is itself the NestJS app | It is configured, but installs run at the root without `--workspace` |
| `--app` given | Wins over detection; accepts package name, relative path, or absolute path |
| `--cwd` given | Treats that directory as the starting point (still discovers the workspace root) |
| `--pm` given | Wins over every detection source |
| `--yes` (or no TTY) | Never prompts; ambiguity becomes an error with code 2; Swagger defaults to enabled |
| `--no-install` | Writes files but installs nothing |
| `--no-lint` | Does not run the app's `lint` script |

## Resolution algorithm

1. Start at `--cwd` (resolved against `process.cwd()`) or `process.cwd()`.
2. Walk up until the repository root (nearest `.git`) or the filesystem root.
   The nearest directory that contains `pnpm-workspace.yaml`, `lerna.json`, or a
   `package.json` with `workspaces` is the workspace root. If no such marker
   exists, the nearest directory with `turbo.json` is used as a fallback.
3. Read workspace globs from `package.json#workspaces` (array or
   `{ packages: [] }`) and from `pnpm-workspace.yaml#packages`. Supported glob
   shapes: `apps/*`, `packages/*`, `packages/**`, exact paths, and `!`
   exclusions. Brace expansion is not supported yet.
4. Expand the globs into workspace packages. `node_modules`, `.git`, `.turbo`,
   `dist`, `build`, `coverage`, `.next`, and similar output folders are skipped.
   When no globs can be read, a depth-limited scan (3 levels) is used.
5. Pick the target app:
   - `--app` (path or package name), else
   - the nearest `package.json` at or above the start directory, if it lists
     `@nestjs/core`/`@nestjs/common`, else
   - when started at the workspace root: the only NestJS candidate, or a
     prompt/error when there are several, else
   - a clean error when the start directory is a non-NestJS member.
   A candidate must list `@nestjs/core` or `@nestjs/common` and have a `src/`
   directory. A package that lists NestJS but has no `src/` still becomes the
   target so the existing preflight error is shown.
6. Resolve the package manager, in order:
   - `--pm`
   - `packageManager` in the workspace root `package.json` (corepack)
   - lockfile at the workspace root: `pnpm-lock.yaml`, `yarn.lock`,
     `bun.lock`/`bun.lockb`, `package-lock.json`/`npm-shrinkwrap.json`
   - `npm_config_user_agent` (the tool that launched `npx`/`pnpm dlx`)
   - npm
7. `turbo.json` is only used to enable Turbo hints. It never decides the app,
   the package manager, or the file locations, and it is never modified.

## Package manager commands

| PM | Add dependencies (workspace) | Run a script (workspace) |
| --- | --- | --- |
| npm | `<root>$ npm install <pkgs> --workspace <name>` | `<root>$ npm run lint --workspace <name>` |
| pnpm | `<root>$ pnpm --filter <name> add <pkgs>` | `<root>$ pnpm --filter <name> run lint` |
| yarn | `<root>$ yarn workspace <name> add <pkgs>` | `<root>$ yarn workspace <name> run lint` |
| bun | `<app>$ bun add <pkgs>` | `<app>$ bun run lint` |

npm, pnpm, and yarn run from the workspace root and target the member by name.
Bun has no per-workspace add flag, so the plain command runs with the app as the
working directory. A standalone repository uses each PM's plain `add`/`run`
command in the project directory.

## Install-before-write

Dependencies are installed before any file in `src/`, `app.module.ts`,
`main.ts`, or `.env.example` is created or modified. If the install fails:

- the process exits with code 1,
- the error shows the exact command and the failing step,
- no project files have been written.

This makes a failed run safe to retry. npm peer conflicts are retried once with
`--legacy-peer-deps`; the retry also happens before files are written.

## Version detection

The CLI looks for the installed `@nestjs/common` package by walking up from the
app directory, so versions hoisted by npm or pnpm are found. If the package is
not installed yet, it falls back to the declared range in the app or workspace
`package.json`.

pnpm `catalog:` and `catalog:<name>` ranges are resolved from
`pnpm-workspace.yaml`, so the correct NestJS major is known even on a fresh
clone or with `--no-install`.

## Yarn PnP

Yarn Plug'n'Play is not supported yet. It has no `node_modules`, so version
detection cannot work. The CLI detects `.pnp.cjs`/`.pnp.js` and exits with an
explicit message. Switch to `nodeLinker: "node-modules"` or use `--no-install`
and wire the modules manually.

```yaml
# .yarnrc.yml
nodeLinker: node-modules
```

## Known limitations

- Yarn PnP is unsupported (see above).
- Nested workspaces (a workspace package that is itself a workspace root) are
  out of scope; the nearest workspace root wins.
- Brace expansion in workspace globs is out of scope.
- `turbo.json` is never modified; Turbo hints are printed at the end.
- Real installs for pnpm/yarn/bun are covered by command construction and the
  fake-binary tests; a CI machine with those package managers should run the
  release smoke tests in `docs/release.md`.

## Acceptance scenarios

1. Single-package repo: file output identical to 3.0.0.
2. npm workspace, run from `apps/api`: target is `apps/api`, PM is npm.
3. npm workspace, run from the root: target is the only NestJS app.
4. pnpm workspace with `catalog:` dependencies: PM is pnpm and the Nest major
   comes from the catalog.
5. Two NestJS apps at the root: interactive prompt; `--yes` exits with code 2.
6. `--app @repo/api`, `--app apps/api`, and `--cwd <abs path>` each select the
   expected app.
7. Non-NestJS member: exits with a message that lists the candidates.
8. `node_modules` and `dist` contents never appear as candidates.
9. npm workspace: install runs at the root with `--workspace <name>` and before
   any project file is written.
10. Failing install: exits with code 1, prints the exact command, and leaves no
    `src/common`, `main.ts` changes, or `.env.example`.
11. Workspace root that is itself the NestJS app: install runs at the root
    without `--workspace`.
12. `--no-install` and `--no-lint` skip only their own steps.

## Test fixtures

`test/workspace.test.js` builds temporary fixtures for the resolution scenarios.
`test/unit.test.js` checks CLI parsing, package-manager command builders, and
version detection (including hoisted packages and pnpm catalogs).
`test/install.test.js` uses a fake package-manager binary to assert the working
directory, `--workspace` target, and install-before-write ordering.
`test/package.test.js` guards the published file list and release docs.
