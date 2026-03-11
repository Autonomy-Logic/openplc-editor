import { resolveAIInitialState } from '../resolve-ai-initial-state'

describe('resolveAIInitialState', () => {
  it('returns enabled and consented when config has both true', () => {
    const result = resolveAIInitialState({
      isFeatureEnabled: true,
      hasUserConsented: true,
    })
    expect(result).toEqual({
      isEnabled: true,
      hasConsented: true,
    })
  })

  it('returns disabled and not consented when config has both false', () => {
    const result = resolveAIInitialState({
      isFeatureEnabled: false,
      hasUserConsented: false,
    })
    expect(result).toEqual({
      isEnabled: false,
      hasConsented: false,
    })
  })

  it('returns enabled but not consented when only feature is enabled', () => {
    const result = resolveAIInitialState({
      isFeatureEnabled: true,
      hasUserConsented: false,
    })
    expect(result).toEqual({
      isEnabled: true,
      hasConsented: false,
    })
  })

  it('returns disabled but consented when only consent is given', () => {
    const result = resolveAIInitialState({
      isFeatureEnabled: false,
      hasUserConsented: true,
    })
    expect(result).toEqual({
      isEnabled: false,
      hasConsented: true,
    })
  })
})
