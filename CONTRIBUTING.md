# Contributing

## Licensing and the Contributor License Agreement

The OpenPLC Editor is licensed under the GPLv3. The baremetal runtime it carries (`resources/sources`) is dual-licensed under the GPLv3 and a commercial licence.

- **Contributor License Agreement.** By ticking the Contributor License Agreement checkbox in the pull request template, you agree that your contribution is licensed to Autonomy Logic Inc. under the terms of the [Contributor License Agreement](CLA.md). The CLA check fails until the box is ticked. You keep the copyright on your contribution.
- **Always available under the GPLv3.** Every contribution accepted here stays available under the GPLv3, in addition to any commercial licence.
- **SPDX header.** Every new source file under `resources/sources` starts with `SPDX-License-Identifier: GPL-3.0-only`, and the Autonomy copyright line for code written by Autonomy; third-party files carry SPDX only.
- **Third-party code.** Do not add third-party code unless its licence is compatible with both the GPLv3 and the commercial licence. Ask in the pull request when in doubt.

## Setup

Requires Node.js >= 22 < 24. See README.md for the full step by step.

```bash
npm install
npm run dev        # dev server on port 1313
```

## Workflow

1. Internal work is tracked in Jira, project DOPE (internal tracker). External contributors: open a GitHub issue using the provided templates.
2. Branch from `development`, named `feature/DOPE-<n>-<kebab-slug>` for features or `bugfix/DOPE-<n>-<kebab-slug>` for bugs. Every internal change, maintenance included, needs a DOPE ticket. A production hotfix is a `bugfix/DOPE-<n>-<kebab-slug>` branch from `main` plus a PR. External contributors without Jira access: use the GitHub issue number instead (`feature/gh-<n>-<kebab-slug>` or `bugfix/gh-<n>-<kebab-slug>`); a maintainer files the DOPE ticket when needed.
3. Commit style: Conventional Commits, concise, focused on why. For internal work, the Jira key goes in the branch name and the PR title, not in commit messages.
4. Open a PR targeting `development` and fill in the PR template.

## Before pushing

Run the checks CI runs (`.github/workflows/`) on your existing install:

```bash
npx tsc --noEmit
npx prettier --check "./src/**/*.{ts,tsx}"
npx eslint "./src/**/*.{ts,tsx}"
npx jest --config jest.config.json --collectCoverage --ci   # unit tests (Jest, with coverage)
npm run validate:arch  # architecture layer dependencies
npm run test:e2e       # end-to-end (Playwright, not run by CI; runs npm run build first; the preload copy from CLAUDE.md "Electron e2e" must be in place)
```

No pre-commit hook is committed (there is no `.husky/` directory), so run these yourself.

## Docs

If your change alters documented behavior (commands, endpoints, env vars, architecture, setup steps), update the affected docs (README, CLAUDE.md, docs/) in the same PR.

## Review

PRs are reviewed against `.claude/review-guidelines.md`.
