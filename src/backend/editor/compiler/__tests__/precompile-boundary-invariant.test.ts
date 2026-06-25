import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

// Static lint protecting the invariant documented in
// `resources/sources/arduino/arduino_runtime_glue.h` (lines 19-22) and
// expanded in the project's design discussion:
//
//   No TU on either side of the precompile/arduino-cli boundary may
//   see flags or macros from the other side.
//
// Concretely:
//   - boundary headers (included by BOTH the precompiled gnu++17 archive
//     AND the arduino-cli-compiled sketch) must stay C-safe — no
//     <Arduino.h>, no `strucpp::`, no strucpp template includes.
//   - files compiled by arduino-cli with the core's default C++ std
//     (Baremetal/, hal/) must stay free of `strucpp::` and strucpp
//     template includes, otherwise the std-mismatch ABI break the
//     precompile pipeline was built to prevent leaks back in.
//
// Pure static text scan. Does not compile the files; does not depend on
// a specific Arduino core; runs deterministically on every host.

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..')
const SOURCES_DIR = join(REPO_ROOT, 'resources', 'sources')

// Files shipped in `resources/sources/arduino/` that may legitimately be
// included from BOTH the precompiled gnu++17 archive AND the
// arduino-cli-compiled sketch (via arduino_runtime_glue.h and openplc.h
// transitively). They share the strict C-safe contract.
const BOUNDARY_HEADERS: ReadonlyArray<string> = [
  'arduino/arduino_runtime_glue.h',
  'arduino/openplc.h',
  'arduino/Arduino_OpenPLC.h',
  'arduino/c_blocks.h',
  'arduino/debug.h',
]

// Directories whose source files are compiled by arduino-cli with the
// board core's default C++ standard. They must never reference strucpp.
const ARDUINO_CLI_SIDE_DIRS: ReadonlyArray<string> = ['Baremetal', 'hal']

const ARDUINO_CLI_SIDE_EXTS: ReadonlyArray<string> = ['.cpp', '.h', '.hpp', '.ino', '.c']

const ARDUINO_HEADER_INCLUDE = /#\s*include\s*[<"]Arduino\.h[>"]/
const STRUCPP_NAMESPACE = /\b(namespace\s+strucpp\b|strucpp\s*::)/
const STRUCPP_TEMPLATE_INCLUDE =
  /#\s*include\s*[<"](generated(?:_debug)?|debug_dispatch|iec_[A-Za-z_0-9]+|IECVar|strucpp_runtime\/[^"<>]+)\.h(?:pp)?[>"]/

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

function collectFilesRecursive(dir: string, allowedExts: ReadonlyArray<string>): string[] {
  const out: string[] = []
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry)
      if (statSync(full).isDirectory()) {
        walk(full)
      } else if (allowedExts.some((ext) => entry.endsWith(ext))) {
        out.push(full)
      }
    }
  }
  walk(dir)
  return out.sort()
}

function relFromSources(absolutePath: string): string {
  return absolutePath.substring(SOURCES_DIR.length + 1).replace(/\\/g, '/')
}

describe('precompile/arduino-cli boundary invariants', () => {
  describe('boundary headers stay C-safe (no Arduino.h, no strucpp leak)', () => {
    for (const rel of BOUNDARY_HEADERS) {
      const absolute = join(SOURCES_DIR, rel)

      it(`${rel} must not include <Arduino.h>`, () => {
        const code = stripComments(readFileSync(absolute, 'utf-8'))
        expect(code).not.toMatch(ARDUINO_HEADER_INCLUDE)
      })

      it(`${rel} must not reference the strucpp namespace`, () => {
        const code = stripComments(readFileSync(absolute, 'utf-8'))
        expect(code).not.toMatch(STRUCPP_NAMESPACE)
      })

      it(`${rel} must not include strucpp template headers`, () => {
        const code = stripComments(readFileSync(absolute, 'utf-8'))
        expect(code).not.toMatch(STRUCPP_TEMPLATE_INCLUDE)
      })
    }
  })

  describe('arduino-cli-side TUs stay strucpp-free', () => {
    for (const subdir of ARDUINO_CLI_SIDE_DIRS) {
      const dirAbs = join(SOURCES_DIR, subdir)
      const files = collectFilesRecursive(dirAbs, ARDUINO_CLI_SIDE_EXTS)

      it(`${subdir}/ has at least one source file to scan (guards against silent path drift)`, () => {
        expect(files.length).toBeGreaterThan(0)
      })

      for (const file of files) {
        const rel = relFromSources(file)

        it(`${rel} must not reference the strucpp namespace`, () => {
          const code = stripComments(readFileSync(file, 'utf-8'))
          expect(code).not.toMatch(STRUCPP_NAMESPACE)
        })

        it(`${rel} must not include strucpp template headers`, () => {
          const code = stripComments(readFileSync(file, 'utf-8'))
          expect(code).not.toMatch(STRUCPP_TEMPLATE_INCLUDE)
        })
      }
    }
  })

  describe('invariant documentation in arduino_runtime_glue.h survives edits', () => {
    it('preserves the "MUST stay free of" warning that codifies the rule for future readers', () => {
      const path = join(SOURCES_DIR, 'arduino', 'arduino_runtime_glue.h')
      const raw = readFileSync(path, 'utf-8')
      // Don't strip comments here — this assertion checks the comment block itself.
      expect(raw).toMatch(/MUST stay free of/i)
      expect(raw).toMatch(/namespace strucpp/)
      expect(raw).toMatch(/generated\.hpp|iec_\*\.hpp|iec_\.\*\.hpp/)
    })
  })
})
