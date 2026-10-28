# Review Guidelines

Order of concern: correctness, architecture, tests, style.

- Layer dependencies respect ports and adapters: frontend, backend, and middleware only communicate through the ports in `src/middleware/shared/ports/`. `npm run validate:arch` must pass.
- DTOs cross layer boundaries, never domain entities.
- Coverage floors in `jest.config.json` hold; every demand comes with unit tests (Jest), an end-to-end test (Playwright) and the developer's manual test.
- TypeScript Best Practices in CLAUDE.md apply to every diff (no `any`, no `as`, no `!`, no floating promises, boundary validation over casting).
- Named exports over default exports.
- No emojis in code, comments, or docs.
- Docs updated when documented behavior changes (README, CLAUDE.md, docs/).
