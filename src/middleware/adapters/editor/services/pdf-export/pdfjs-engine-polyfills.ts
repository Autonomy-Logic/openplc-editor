/**
 * pdf.js 6.3.289 (pinned in package.json — see below) calls several very
 * recent JS platform APIs (TC39 proposals that shipped in V8 well after
 * Electron 35's bundled Chromium 124) directly from its main API layer
 * (`pdf.mjs`) and, since `ProjectPort.preparePdfPreviewWorker` runs pdf.js's
 * worker code in-process too, from `pdf.worker.min.mjs` as well. Each is
 * guarded so a future Electron upgrade with native support is a no-op, but
 * this list was hand-verified against 6.3.289's source only — a version bump
 * needs the same check (grep the new pdf.mjs/pdf.worker.min.mjs for the
 * method names below) before it's safe to move off the exact pin.
 */
function applyPdfJsEnginePolyfills(): void {
  if (typeof Uint8Array.prototype.toHex !== 'function') {
    Object.defineProperty(Uint8Array.prototype, 'toHex', {
      value(this: Uint8Array) {
        return Array.from(this, (byte) => byte.toString(16).padStart(2, '0')).join('')
      },
      writable: true,
      configurable: true,
    })
  }

  if (typeof Uint8Array.prototype.toBase64 !== 'function') {
    Object.defineProperty(Uint8Array.prototype, 'toBase64', {
      value(this: Uint8Array, options?: { alphabet?: 'base64' | 'base64url'; omitPadding?: boolean }) {
        let binary = ''
        for (let i = 0; i < this.length; i += 1) binary += String.fromCharCode(this[i])
        let base64 = btoa(binary)
        if (options?.alphabet === 'base64url') base64 = base64.replace(/\+/g, '-').replace(/\//g, '_')
        if (options?.omitPadding) base64 = base64.replace(/=+$/, '')
        return base64
      },
      writable: true,
      configurable: true,
    })
  }

  if (typeof Uint8Array.fromBase64 !== 'function') {
    Object.defineProperty(Uint8Array, 'fromBase64', {
      value(base64: string, options?: { alphabet?: 'base64' | 'base64url' }) {
        const normalized = options?.alphabet === 'base64url' ? base64.replace(/-/g, '+').replace(/_/g, '/') : base64
        const binary = atob(normalized)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
        return bytes
      },
      writable: true,
      configurable: true,
    })
  }

  if (typeof Map.prototype.getOrInsert !== 'function') {
    Object.defineProperty(Map.prototype, 'getOrInsert', {
      value<K, V>(this: Map<K, V>, key: K, value: V) {
        if (this.has(key)) return this.get(key) as V
        this.set(key, value)
        return value
      },
      writable: true,
      configurable: true,
    })
  }

  if (typeof Map.prototype.getOrInsertComputed !== 'function') {
    Object.defineProperty(Map.prototype, 'getOrInsertComputed', {
      value<K, V>(this: Map<K, V>, key: K, callbackfn: (key: K) => V) {
        if (this.has(key)) return this.get(key) as V
        const value = callbackfn(key)
        this.set(key, value)
        return value
      },
      writable: true,
      configurable: true,
    })
  }

  if (typeof Promise.try !== 'function') {
    Object.defineProperty(Promise, 'try', {
      value<T, A extends readonly unknown[]>(callbackFn: (...args: A) => T | PromiseLike<T>, ...args: A) {
        return new Promise<T>((resolve) => resolve(callbackFn(...args)))
      },
      writable: true,
      configurable: true,
    })
  }
}

export { applyPdfJsEnginePolyfills }
