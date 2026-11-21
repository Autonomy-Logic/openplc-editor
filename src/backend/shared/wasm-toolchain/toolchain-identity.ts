/**
 * Identity of the WebAssembly toolchain every platform loads: the exact `@yowasp/clang` version pinned in
 * `package.json`. The same version is the same clang, lld, libc++ and sysroot on every platform, so objects compiled
 * by one are valid on all.
 */
export const WASM_TOOLCHAIN_PACKAGE = '@yowasp/clang'
export const WASM_TOOLCHAIN_VERSION = '22.0.0-git20542-10'
export const WASM_TOOLCHAIN_IDENTITY = `${WASM_TOOLCHAIN_PACKAGE}@${WASM_TOOLCHAIN_VERSION}`
