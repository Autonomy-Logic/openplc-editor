import { resolveHtmlPath } from '../resolve-html-path'

describe('resolveHtmlPath', () => {
  const originalEnv = process.env.NODE_ENV
  const originalPort = process.env.PORT

  afterEach(() => {
    process.env.NODE_ENV = originalEnv
    process.env.PORT = originalPort
  })

  it('returns localhost URL in development mode with default port', () => {
    process.env.NODE_ENV = 'development'
    delete process.env.PORT

    const result = resolveHtmlPath('index.html')
    expect(result).toBe('http://localhost:1212/index.html')
  })

  it('returns localhost URL in development mode with custom port', () => {
    process.env.NODE_ENV = 'development'
    process.env.PORT = '3000'

    const result = resolveHtmlPath('index.html')
    expect(result).toBe('http://localhost:3000/index.html')
  })

  it('returns file:// URL in production mode', () => {
    process.env.NODE_ENV = 'production'

    const result = resolveHtmlPath('index.html')
    expect(result).toMatch(/^file:\/\//)
    expect(result).toContain('renderer')
    expect(result).toContain('index.html')
  })
})
