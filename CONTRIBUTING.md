# Contributing

## Setup

Requires Node.js >= 22 < 24. See README.md for the full step by step.

```bash
npm install
npm run dev        # dev server on port 1313
```

## Workflow

1. Internal work is tracked in Jira, project DOPE (internal tracker). External contributors: open a GitHub issue using the provided templates.
2. Branch from `development`, named `feature/DOPE-<n>-<kebab-slug>` for features or `bugfix/DOPE-<n>-<kebab-slug>` for bugs. Maintenance without a ticket uses `chore/`, `ci/`, `docs/`. External contributors without Jira access: use the GitHub issue number instead (`feature/gh-<n>-<kebab-slug>` or `bugfix/gh-<n>-<kebab-slug>`); a maintainer files the DOPE ticket when needed.
3. Commit style: Conventional Commits, concise, focused on why. The Jira key goes in the branch name and the PR title, not in commit messages.
4. Open a PR targeting `development` and fill in the PR template.

## Before pushing

Run the checks CI runs (`.github/workflows/`) on your existing install:

```bash
npx tsc --noEmit
npx prettier --check "./src/**/*.{ts,tsx}"
npx eslint "./src/**/*.{ts,tsx}"
npx jest --config jest.config.json --collectCoverage --ci   # unit tests (Jest, with coverage)
npm run validate:arch  # architecture layer dependencies
npm run test:e2e       # end-to-end (Playwright, requires a build; not run by CI)
```

No pre-commit hook is committed (there is no `.husky/` directory), so run these yourself.

## Docs

If your change alters documented behavior (commands, endpoints, env vars, architecture, setup steps), update the affected docs (README, CLAUDE.md, docs/) in the same PR.

## Review

PRs are reviewed against `.claude/review-guidelines.md`.
