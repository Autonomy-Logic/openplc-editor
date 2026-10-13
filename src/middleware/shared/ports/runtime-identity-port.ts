// Only where the platform reaches the runtime directly; the fingerprint always comes from the user.

export interface RuntimeIdentityPin {
  /** Lowercase hex SHA-256 of the runtime's DER certificate. */
  sha256: string
  updatedAt: string
}

export type RuntimeIdentityWriteResult =
  | { ok: true; pin: RuntimeIdentityPin }
  | { ok: false; code: 'runtime_identity_invalid' | 'runtime_identity_unavailable'; message: string }

export interface RuntimeIdentityPort {
  getPin(targetKey: string): Promise<RuntimeIdentityPin | null>
  setPin(targetKey: string, fingerprint: string): Promise<RuntimeIdentityWriteResult>
  removePin(targetKey: string): Promise<void>
}
