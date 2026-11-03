# Windows releases

[Release Please](https://github.com/googleapis/release-please-action) handles versions, changelogs, tags, and GitHub release drafts. The [release workflow](../.github/workflows/release-please.yml) runs on pushes to `main` and can also be started manually.

## How a release works

1. Merge changes into `main` using Conventional Commit messages, such as `fix: correct shop guidance` or `feat: add item tooltips`. Release Please creates or updates a release PR with the next version, `package.json`, `package-lock.json`, `CHANGELOG.md`, and its version manifest.
2. Review and merge that release PR. Release Please creates its `vX.Y.Z` tag and release draft. The configuration explicitly creates tags for drafts so the next release can find the previous version.
3. The same workflow checks out that exact tag, verifies the version files, runs all checks and desktop smoke tests, builds the Windows x64 portable executable, and smoke-tests the executable itself. It generates `SHA256SUMS.txt`, checks it again after downloading the build artifacts, and attaches both files to the existing release draft.
4. Review the completed draft and publish it when ready. The README's latest-release link points to the latest published stable release.

Release Please owns version changes and release creation; there is no manual `npm version`, tagging, or separate tag-triggered release workflow. The manifest starts from the current package version, `0.1.0`; the first proposed release is determined from the merged commits. Before 1.0, breaking changes bump the minor version. Automated game-data PRs use `fix(data):` so merging new game data can trigger a release too.

Drafts preserve the opportunity to review the [distribution requirements](development.md#license-and-distribution) and real-client acceptance checks before publication. Automated checks do not establish real-match performance, HUD alignment, or Riot approval. The asset-upload job refuses to replace files on a published release.

## GitHub setup and CI

Enable **Allow GitHub Actions to create and approve pull requests** under repository **Settings > Actions > General**. The workflow grants Release Please repository, issue-label, and pull-request write access. The Windows build job has read-only repository access; only the final asset-upload job can write release assets.

The built-in `GITHUB_TOKEN` is sufficient for release PRs, drafts, and executable uploads. GitHub does not start separate workflows from PRs or tags created with that token, so the executable jobs run directly after Release Please in the same workflow.

For automatic CI on release PRs, optionally configure the repository secret `RELEASE_PLEASE_TOKEN` with an appropriately scoped GitHub App or personal access token. The workflow prefers that token when present. Without it, use **Actions > Quality and Windows build > Run workflow** on the release PR branch to run any required checks before merging. The complete release checks still run after the release PR is merged, before assets are attached.

See the upstream [token behavior and permissions](https://github.com/googleapis/release-please-action#github-credentials) and [manifest configuration](https://github.com/googleapis/release-please/blob/main/docs/manifest-releaser.md).

## Build and test locally

Use Node.js 24 on Windows:

```sh
npm ci
npm run release:verify -- v0.1.0
npm run check
npm run smoke
npm run dist
npm run smoke:package
npm run release:assets
```

Replace `v0.1.0` with the checked-out package's version tag. The executable is written to `dist/LoL-Utils-<version>-win-x64.exe`. `release:assets` hashes that exact file and writes `dist/SHA256SUMS.txt`; it fails if the file is missing or lacks a Windows executable signature. Building with `dist` or `pack` never uploads anything.

The executable is portable: download and run it without Node.js or an installer. Releases are unsigned unless Windows code-signing credentials are separately configured; Windows may display an unknown-publisher prompt. Checksums verify the downloaded bytes, not publisher identity. Portable apps do not update themselves: download a newer release to update the app and bundled game data.

## Recover a failed build or upload

A failed executable build leaves the release draft without completed assets. Use **Re-run failed jobs** on the original workflow run to retain its Release Please outputs.

Alternatively, select **Actions > Release Please and Windows executable > Run workflow** on `main` and enter the existing draft tag in `release_tag`. This rebuilds that tag and uploads the verified files to its existing draft, without creating a new version or release. Leave `release_tag` empty to run Release Please normally. Rerunning all jobs after a draft was already created may otherwise produce no new release output and skip the executable jobs.

Fix published code through a new Conventional Commit and release PR rather than moving a tag or replacing published assets.
