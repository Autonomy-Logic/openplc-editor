import { createContext, runInContext } from 'node:vm'

import ts from 'typescript'

import type {
  CreatePackageTrustAnchor,
  PackageTrustAnchor,
  PackageTrustMechanisms,
} from '../../src/backend/editor/package-trust/types'
import { isRecord } from './generator'

/** The method @p name of @p target; throws when it is not a function. */
function methodOf(target: unknown, name: string): (...args: unknown[]) => unknown {
  const method: unknown = isRecord(target) ? target[name] : undefined
  if (typeof method !== 'function') throw new Error(`The trust anchor has no ${name} method`)
  return (...args) => {
    const result: unknown = Reflect.apply(method, target, args)
    return result
  }
}

function toKeyMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) throw new Error('trustedKeys() did not return a key map')
  const keys: Record<string, string> = {}
  for (const [keyId, pem] of Object.entries(value)) {
    if (typeof pem !== 'string') throw new Error(`trustedKeys() returned a non-string key for ${keyId}`)
    keys[keyId] = pem
  }
  return keys
}

function toVerdict(value: unknown): string | null {
  if (value === null || typeof value === 'string') return value
  throw new Error('A trust hook returned neither null nor a reason')
}

/**
 * Loads a generated trust module from its TypeScript @p source: transpiled to CommonJS and evaluated in a fresh
 * `vm` context that has no `require`, so a module that imports anything at runtime fails to load.
 * @throws {Error} when the source does not export a `createPackageTrustAnchor` function
 */
export function loadTrustModule(source: string): CreatePackageTrustAnchor {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const moduleExports: Record<string, unknown> = {}
  const context = createContext({ exports: moduleExports, module: { exports: moduleExports } })
  runInContext(outputText, context, { filename: 'package-trust-anchor.js' })
  const create = moduleExports.createPackageTrustAnchor
  if (typeof create !== 'function') throw new Error('The trust module exports no createPackageTrustAnchor function')

  return (mechanisms: PackageTrustMechanisms): PackageTrustAnchor => {
    const anchor: unknown = Reflect.apply(create, undefined, [mechanisms])
    const trustedKeys = methodOf(anchor, 'trustedKeys')
    const checkAtImport = methodOf(anchor, 'checkAtImport')
    const checkAtUse = methodOf(anchor, 'checkAtUse')
    return {
      trustedKeys: () => toKeyMap(trustedKeys()),
      checkAtImport: (packageDir) => toVerdict(checkAtImport(packageDir)),
      checkAtUse: (packageDir) => toVerdict(checkAtUse(packageDir)),
    }
  }
}
