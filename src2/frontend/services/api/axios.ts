import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios'

const baseURL = import.meta.env?.VITE_EDGE_API_URL || 'http://localhost:3333'

export const api = axios.create({
  baseURL,
  timeout: 30000,
  withCredentials: true, // Required for cross-origin cookie handling
  headers: {
    'Content-Type': 'application/json',
  },
})

// Request interceptor
api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const fullURL = `${config.baseURL || ''}${config.url || ''}`
    const cookies = typeof document !== 'undefined' ? document.cookie : 'unavailable'
    const hasCookies = cookies && cookies.length > 0
    const hasAccessTokenCookie = cookies.includes('accessToken=')

    console.log('[Auth Debug] Axios Request Interceptor:', {
      method: config.method?.toUpperCase(),
      url: config.url,
      baseURL: config.baseURL,
      fullURL,
      withCredentials: config.withCredentials,
      hasCookies,
      hasAccessTokenCookie,
      cookiePreview: hasAccessTokenCookie ? cookies.substring(0, 100) + '...' : 'no accessToken cookie found',
      authHeader: config.headers?.Authorization ? 'present (SHOULD NOT BE!)' : 'none (correct)',
    })

    return config
  },
  (error: AxiosError) => {
    console.error('[Auth Debug] Request interceptor error:', error)
    return Promise.reject(error)
  },
)

// Response interceptor
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response) {
      const { status } = error.response

      if (status === 401) {
        // Handle unauthorized - could redirect to login or clear tokens
        console.error('Unauthorized request')
      }

      if (status === 500) {
        console.error('Server error')
      }
    }

    return Promise.reject(error)
  },
)

export default api
