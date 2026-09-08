// monaco-editor ships no CommonJS entry point (package.json has no "main",
// only an ESM "module" field), so plain `require.resolve('monaco-editor')`
// fails under Jest — this mapping gives it a real, resolvable path so
// `jest.mock('monaco-editor', factory)` in individual test files can
// register their own factory instead of hitting a MODULE_NOT_FOUND error.
// Tests that don't provide their own factory get this harmless stub.
export const editor = { tokenize: () => [] }
