import type { AIFeatureConfig } from './types'

/**
 * Derives the AI-specific initial state overrides from platform configuration.
 *
 * Business rules:
 * - AI is enabled only when the platform feature flag is on
 * - Consent status is loaded from persistent storage at startup
 *
 * Returns only the fields that depend on platform config. The caller merges
 * these with the slice's hardcoded defaults.
 */
export function resolveAIInitialState(config: AIFeatureConfig) {
  return {
    isEnabled: config.isFeatureEnabled,
    hasConsented: config.hasUserConsented,
  }
}
