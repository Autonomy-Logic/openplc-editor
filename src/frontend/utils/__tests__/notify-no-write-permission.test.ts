// Test globals (`describe`, `it`, `expect`, `beforeEach`, `vi`) come from
// the runner — Jest provides them via `injectGlobals`, Vitest via the
// `globals: true` option.  Editor's `jest-vi-shim.ts` aliases `vi` →
// `jest` so the same `vi.mock(...)` calls work on both runners.
//
// We deliberately do NOT import the SUT or its dependency at the top
// of the file.  Editor runs under Jest, whose `babel-plugin-jest-hoist`
// only recognises literal `jest.mock(...)` — it doesn't hoist `vi.mock`
// (the alias is set up at runtime via `jest-vi-shim.ts`).  Vitest's
// transform hoists `vi.mock` natively.  To work on both runners the
// test loads the SUT via `require()` inside the test body, AFTER the
// `vi.mock` line has registered its factory; the require then resolves
// against the mocked module table.
//
// `@root/...` absolute paths are load-bearing here too: editor's
// `jest-vi-shim.ts` re-points `vi` at `jest` at runtime, after which
// `jest.mock(...)`'s call-site detection reports the shim file as the
// origin and a relative `'../toast'` resolves from there (project root)
// instead of from this test file.  Both `moduleNameMapper` (jest) and
// `resolve.alias` (vitest) map `@root/*` to `src/*`, so the same path
// resolves identically on each runner.
vi.mock('@root/frontend/utils/toast', () => ({
  toast: vi.fn(),
}))

describe('notifyNoWritePermission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows a warn toast that slots the action verb into the message', () => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { notifyNoWritePermission } = require('@root/frontend/utils/notify-no-write-permission')
    const { toast } = require('@root/frontend/utils/toast')
    /* eslint-enable @typescript-eslint/no-require-imports */

    notifyNoWritePermission('save changes to')

    expect(toast).toHaveBeenCalledTimes(1)
    expect(toast).toHaveBeenCalledWith({
      title: 'No write permission',
      description: "You don't have permission to save changes to this project.",
      variant: 'warn',
    })
  })
})
