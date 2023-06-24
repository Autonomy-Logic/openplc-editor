export type ServiceResponse<T = unknown> = {
  ok: boolean
  reason?: {
    title: string
    description?: string
  }
  data?: T
}
