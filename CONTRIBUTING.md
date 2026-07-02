# Contributing

## Setup

Requires Node.js >= 22 < 24. See README.md for the full step by step.

```bash
npm install
npm run dev        # dev server on port 1313
```

## Workflow

1. Internal work is tracked in Jira, project DOPE (internal tracker). External contributors: open a GitHub issue using the provided templates.
2. Branch from `development`, named `<type>/DOPE-<n>-<kebab-slug>` (`<type>`: feature, bugfix, task, improvement). Maintenance without a ticket uses `chore/`, `ci/`, `docs/`.
3. Commit style: Conventional Commits, concise, focused on why.
4. Open a PR targeting `development` and fill in the PR template.

## Before pushing

```bash
npm run test           # unit tests (Jest, with coverage)
npm run test:e2e       # end-to-end (Playwright, requires a build)
npm run validate:arch  # architecture layer dependencies
```

Lint and format run on commit via Husky.

## Docs

If your change alters documented behavior (commands, endpoints, env vars, architecture, setup steps), update the affected docs (README, CLAUDE.md, docs/) in the same PR.

## Review

PRs are reviewed against `.claude/review-guidelines.md`.
