# @yowasp/clang

The WebAssembly clang toolchain the editor ships (`@yowasp/clang` 22.0.0-git20542-10, see `package.json`). Its npm
package carries no licence files (its metadata says ISC), so the texts are kept here and shipped next to the
toolchain. The package was published on 2026-03-12; the sources below are the YoWASP commit before that release and
the submodules it pins.

- `LICENSE.txt`: YoWASP, Apache License 2.0, from
  https://github.com/YoWASP/clang/blob/944dd7c774954180e621cc8e12984023a7f8bcbe/LICENSE.txt
- `llvm-project/`: Apache License 2.0 with LLVM Exceptions, plus each component's legacy notices: the root
  `LICENSE.TXT` and those of `llvm`, `clang`, `lld`, `libcxx`, `libcxxabi` and `compiler-rt`, from
  https://github.com/YoWASP/llvm-project/tree/97196c8eeb1d495fa43bb8af2fb26af5ef5b89fb
- `wasi-libc/`: Apache License 2.0 with LLVM Exceptions, Apache License 2.0 and MIT, plus musl's `COPYRIGHT`, from
  https://github.com/WebAssembly/wasi-libc/tree/ac020b86fd44bafe60aa4fa12f407d16e3731329

When the `@yowasp/clang` version changes, refresh these from the commits that release was built from.
