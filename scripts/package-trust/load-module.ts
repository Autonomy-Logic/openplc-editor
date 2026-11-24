import { createContext, runInContext } from 'node:vm'

import ts from 'typescript'

import type { TrustVerdict, VerifyTrustedPackage } from '../../src/backend/editor/package-trust/types'

/** @p value as a verdict of this realm; throws when it is not a verdict. */
function toVerdict(value: unknown): TrustVerdict {
  if (Array.isArray(value)) {
    const [passed, first, second]: unknown[] = value
    if (passed === true && typeof first === 'string' && typeof second === 'string') return [true, first, second]
    if (passed === false && typeof first === 'string') return [false, first]
  }
  throw new Error('The trust module returned no verdict')
}

/**
 * Loads a generated trust module from its TypeScript @p source: transpiled to CommonJS and evaluated in a fresh `vm`
 * context whose `require` resolves exactly the specifiers of @p imports, each to the object given for it. The context
 * also holds the host's `Buffer`.
 * @throws {Error} naming the specifier when the module imports any other module, or when it has no default export
 * function
 */
export function loadTrustModule(source: string, imports: Record<string, unknown>): VerifyTrustedPackage {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const moduleExports: Record<string, unknown> = {}
  const requireImport = (specifier: unknown): unknown => {
    if (typeof specifier === 'string' && Object.prototype.hasOwnProperty.call(imports, specifier)) {
      return imports[specifier]
    }
    throw new Error(`The trust module imports ${String(specifier)}, which is not allowed`)
  }
  const context = createContext({
    exports: moduleExports,
    module: { exports: moduleExports },
    require: requireImport,
    Buffer,
  })
  runInContext(outputText, context, { filename: 'package-trust-anchor.js' })
  const entry = moduleExports.default
  if (typeof entry !== 'function') throw new Error('The trust module has no default export function')
  return (packageDir, atImport) => toVerdict(Reflect.apply(entry, undefined, [packageDir, atImport]))
}
