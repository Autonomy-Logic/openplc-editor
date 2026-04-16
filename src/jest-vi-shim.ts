// Alias `vi` to `jest` so shared test files can use `vi.spyOn()` in both Jest and Vitest
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).vi = jest
