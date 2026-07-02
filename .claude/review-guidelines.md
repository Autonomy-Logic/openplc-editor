# Review Guidelines

Order of concern: correctness, architecture, tests, style.

- Layer dependencies respect ports and adapters: frontend, backend, and middleware only communicate through the ports in `src/middleware/shared/ports/`. `npm run validate:arch` must pass.
- DTOs cross layer boundaries, never domain entities.
- 100%-coverage directories stay at 100%; new behavior comes with tests (Jest for logic, Playwright for user flows).
- TypeScript strict: no `any`, named exports over default exports.
- No emojis in code, comments, or docs.
- Docs updated when documented behavior changes (README, CLAUDE.md, docs/).
