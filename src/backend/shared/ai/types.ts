/**
 * Platform-provided configuration for the AI feature.
 * Resolved by the composition root from environment variables and persistent storage.
 */
export interface AIFeatureConfig {
  /** Whether the AI feature is enabled on this platform */
  isFeatureEnabled: boolean
  /** Whether the user has previously consented to AI usage */
  hasUserConsented: boolean
}

/**
 * Contract for persisting AI consent decisions across sessions.
 * Implemented by the composition root using platform-specific storage
 * (e.g., localStorage for web, electron-store for desktop).
 */
export interface ConsentStorage {
  load(): boolean
  save(consented: boolean): void
}
