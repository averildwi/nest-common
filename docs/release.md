# Release checklist

Run these steps from the package directory before publishing.

1. **Install exactly what CI installs**

   ```bash
   npm ci
   ```

2. **Run the test suite**

   ```bash
   npm test
   ```

   Expected: all files in `test/` pass on Node 20, 22, and 24.

3. **Inspect the published package**

   ```bash
   npm pack --dry-run
   ```

   The tarball must contain `bin/`, `src/`, `templates/`, `docs/`,
   `CHANGELOG.md`, `LICENSE`, and `README.md`. It must not contain `test/` or
   `node_modules/`.

4. **Update the changelog**

   Move the relevant `## [Unreleased]` entries in `CHANGELOG.md` under the new
   version and date. If the release changes the workspace contract, update
   `docs/monorepo.md` and the README at the same time.

5. **Bump the version**

   ```bash
   npm version <major|minor|patch> --no-git-tag-version
   git add package.json package-lock.json CHANGELOG.md
   git commit -m "chore(release): vX.Y.Z"
   git tag vX.Y.Z
   ```

   Keep `package.json` and `package-lock.json` in sync.

6. **Publish**

   ```bash
   npm publish --access public
   git push && git push --tags
   ```

7. **Verify the published binary**

   ```bash
   npx @averildwi/nest-common@X.Y.Z --help
   npx @averildwi/nest-common@X.Y.Z --version
   ```

## Workspace smoke matrix

Local machines without pnpm/yarn/bun can only verify command construction. The
release should also be exercised on a machine with those package managers:

| Scenario | Command |
| --- | --- |
| Single npm repo | `npx @averildwi/nest-common --yes --no-install --no-lint` |
| npm workspace | `npx @averildwi/nest-common --app @repo/api --yes --no-install --no-lint` |
| pnpm workspace + catalog | `npx @averildwi/nest-common --pm pnpm --app @repo/api --yes --no-install --no-lint` |
| yarn workspace | `npx @averildwi/nest-common --pm yarn --app @repo/api --yes --no-install --no-lint` |
| bun workspace | `npx @averildwi/nest-common --pm bun --app @repo/api --yes --no-install --no-lint` |
| Real install, npm | `npx @averildwi/nest-common --app @repo/api --yes --no-lint` |
| Real install, pnpm | `npx @averildwi/nest-common --pm pnpm --app @repo/api --yes --no-lint` |

For the real-install rows, confirm that:

- the install command runs from the workspace root and targets the app,
- files are written only after the install succeeds,
- `src/common`, `app.module.ts`, `main.ts`, and `.env.example` land in the app,
- `turbo.json` is unchanged.
