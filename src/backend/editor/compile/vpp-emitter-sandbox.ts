/**
 * Isolated execution boundary for VPP screen runtime emitters.
 *
 * Why: VPP emitters are untrusted JavaScript shipped inside third-party packages. The previous
 * implementation ran them straight on the editor's main thread through `vm.Script` with a
 * `timeout` option, but Node's `vm` module is **not** a security boundary and the `timeout`
 * guard applies only to the initial `runInContext` — the exported function is then invoked on
 * the main thread with no deadline, so a `while (true)` in `module.exports` would freeze the
 * entire editor UI (every IPC call to the main process blocks until the loop ever yields).
 *
 * This file replaces that path with a `worker_threads` sandbox: the emitter runs in a short-
 * lived Node worker whose event loop can be killed by `worker.terminate()` when the deadline
 * fires. The guest contract (`input` / `output` shapes) is unchanged — callers that already
 * synthesize an `EmitterInput` keep working, with the `model.resolveAddress` /
 * `model.resolveDebugEntry` function wrappers rebuilt inside the worker from plain record maps
 * (functions cannot cross the `postMessage` boundary).
 */

import { Worker } from 'node:worker_threads'

import { readFileSync } from 'fs'
import { join, normalize, relative } from 'path'
import { createContext, Script } from 'vm'

import type { EmitterDebugEntry, EmitterExportableVariable, EmitterOutput } from './vpp-screen-emitters'

export interface EmitterInvocation {
  /** Directory the installed VPP package resolved to on disk. */
  packageDir: string
  /** Emitter path from the package manifest, relative to `packageDir`. */
  relPath: string
  /** Opaque payload the renderer persisted under this `(packageId, screenId)`. */
  data: unknown
  packageId: string
  screenId: string
  /** PLC model snapshot forwarded verbatim to the emitter. */
  exportableVariables: ReadonlyArray<EmitterExportableVariable>
  /** Resolver the emitter calls as `model.resolveAddress(qualifier)`. The worker sandbox
   *  pre-materializes against `exportableVariables` before crossing `postMessage`; the in-process
   *  sandbox invokes it directly on whatever qualifier the emitter passes. */
  resolveAddress(qualifier: string): string
  /** Resolver the emitter calls as `model.resolveDebugEntry(qualifier)`. Same lifecycle note as
   *  `resolveAddress`. */
  resolveDebugEntry(qualifier: string): EmitterDebugEntry | null
  /** Hard deadline past which the emitter is terminated. */
  deadlineMs: number
}

export interface EmitterSandbox {
  run(invocation: EmitterInvocation): Promise<EmitterOutput>
  /** Release any pooled resources. Safe to call multiple times. */
  dispose(): void
}

function resolveEmitterPath(packageDir: string, relPath: string): string {
  const resolved = normalize(join(packageDir, relPath))
  const rel = relative(packageDir, resolved)
  if (rel === '' || rel.startsWith('..') || rel.includes('..')) {
    throw new Error(`emitter path escapes package: ${relPath}`)
  }
  return resolved
}

/**
 * Worker source inlined as a string so no additional webpack entry / build artifact is required.
 * The worker rebuilds the emitter's `model.resolveAddress` / `resolveDebugEntry` as closures over
 * the plain record maps that crossed `postMessage`.
 */
const WORKER_SOURCE = `
const { readFileSync } = require('fs')
const { parentPort, workerData } = require('node:worker_threads')
const { createContext, Script } = require('vm')
try {
  const { resolved, input } = workerData
  const source = readFileSync(resolved, 'utf-8')
  const addressByQualifier = input.model.addressByQualifier || {}
  const debugMapByQualifier = input.model.debugMapByQualifier || {}
  const model = {
    exportableVariables: input.model.exportableVariables,
    resolveAddress: function (qualifier) { return addressByQualifier[qualifier] || '' },
    resolveDebugEntry: function (qualifier) {
      return Object.prototype.hasOwnProperty.call(debugMapByQualifier, qualifier)
        ? debugMapByQualifier[qualifier]
        : null
    },
  }
  const sandbox = {
    module: { exports: null },
    exports: null,
    JSON: JSON,
    Uint8Array: Uint8Array,
    Array: Array,
    Object: Object,
    String: String,
    Number: Number,
    Boolean: Boolean,
    console: {
      log: function () {
        var parts = ['[vpp-emitter]']
        for (var i = 0; i < arguments.length; i++) parts.push(arguments[i])
        console.log.apply(console, parts)
      },
    },
  }
  const ctx = createContext(sandbox)
  new Script(source, { filename: resolved }).runInContext(ctx)
  const emitFn = sandbox.module.exports
  if (typeof emitFn !== 'function') throw new Error('emitter must assign a function to module.exports')
  const output = emitFn({
    data: input.data,
    model: model,
    packageId: input.packageId,
    screenId: input.screenId,
  })
  parentPort.postMessage({ ok: true, output: output })
} catch (err) {
  parentPort.postMessage({ ok: false, error: err && err.message ? err.message : String(err) })
}
`

/**
 * Production sandbox: each `run()` spawns a short-lived Node worker whose termination budget is
 * enforced by `worker.terminate()`. `terminate()` kills the worker's event loop even when
 * synchronous JavaScript is running inside it, which is exactly the shape of attack the previous
 * main-thread `vm.Script` had no answer for.
 */
export function createWorkerThreadEmitterSandbox(): EmitterSandbox {
  return {
    async run(invocation: EmitterInvocation): Promise<EmitterOutput> {
      const resolved = resolveEmitterPath(invocation.packageDir, invocation.relPath)
      // Pre-materialize the resolver answers against `exportableVariables` (the complete picker
      // surface) because functions cannot cross `postMessage`. An emitter asking for a qualifier
      // outside this list gets an empty address / null entry inside the worker — the picker only
      // exposes qualifiers that live in `exportableVariables`, so a real emitter never asks for
      // one that is not already materialized here.
      const addressByQualifier: Record<string, string> = {}
      const debugMapByQualifier: Record<string, EmitterDebugEntry | null> = {}
      for (const entry of invocation.exportableVariables) {
        addressByQualifier[entry.qualifier] = invocation.resolveAddress(entry.qualifier)
        debugMapByQualifier[entry.qualifier] = invocation.resolveDebugEntry(entry.qualifier)
      }
      return new Promise<EmitterOutput>((resolve, reject) => {
        let settled = false
        const settle = (fn: () => void): void => {
          if (settled) return
          settled = true
          fn()
        }
        const worker = new Worker(WORKER_SOURCE, {
          eval: true,
          workerData: {
            resolved,
            input: {
              data: invocation.data,
              packageId: invocation.packageId,
              screenId: invocation.screenId,
              model: {
                exportableVariables: invocation.exportableVariables,
                addressByQualifier,
                debugMapByQualifier,
              },
            },
          },
        })
        const timer = setTimeout(() => {
          settle(() => reject(new Error(`emitter did not complete within ${invocation.deadlineMs} ms`)))
          void worker.terminate()
        }, invocation.deadlineMs)
        worker.on('message', (msg: { ok: true; output: EmitterOutput } | { ok: false; error: string }) => {
          clearTimeout(timer)
          if (msg.ok) settle(() => resolve(msg.output))
          else settle(() => reject(new Error(msg.error)))
          void worker.terminate()
        })
        worker.on('error', (err: Error) => {
          clearTimeout(timer)
          settle(() => reject(err))
          void worker.terminate()
        })
        worker.on('exit', () => {
          clearTimeout(timer)
          // If the worker exited without a message AND without an error (e.g. forced terminate
          // because of the timeout), the reject above has already fired. This handler just
          // guarantees we never leave the promise un-settled if the worker dies silently.
          settle(() => reject(new Error('emitter worker exited without a response')))
        })
      })
    },
    dispose(): void {
      // No long-lived state yet. Kept on the interface so a future pooled sandbox can clean up.
    },
  }
}

/**
 * In-process sandbox: runs the emitter on the current thread via `vm.Script`, matching the shape
 * `createWorkerThreadEmitterSandbox` presents. Deadlines are enforced only on the initial
 * `runInContext` (same limitation Node's `vm` has), so this variant is intended for unit tests
 * where the emitter source is trusted — it keeps tests fast and synchronous-feeling. **Production
 * code must not use it on untrusted emitters.**
 */
export function createInProcessEmitterSandbox(): EmitterSandbox {
  return {
    async run(invocation: EmitterInvocation): Promise<EmitterOutput> {
      const resolved = resolveEmitterPath(invocation.packageDir, invocation.relPath)
      const source = readFileSync(resolved, 'utf-8')
      const sandbox: Record<string, unknown> = {
        module: { exports: null as unknown },
        exports: null as unknown,
        JSON,
        Uint8Array,
        Array,
        Object,
        String,
        Number,
        Boolean,
        console: { log: (...parts: unknown[]) => console.log('[vpp-emitter]', ...parts) },
      }
      const ctx = createContext(sandbox)
      new Script(source, { filename: resolved }).runInContext(ctx, { timeout: invocation.deadlineMs })
      const emitFn = (sandbox.module as { exports: unknown }).exports
      if (typeof emitFn !== 'function') throw new Error('emitter must assign a function to module.exports')
      return (emitFn as (input: unknown) => EmitterOutput)({
        data: invocation.data,
        model: {
          exportableVariables: invocation.exportableVariables,
          resolveAddress: invocation.resolveAddress,
          resolveDebugEntry: invocation.resolveDebugEntry,
        },
        packageId: invocation.packageId,
        screenId: invocation.screenId,
      })
    },
    dispose(): void {
      // No state.
    },
  }
}
