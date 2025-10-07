export function getRuntimeHttpsOptions(): { rejectUnauthorized: boolean } {
  const shouldReject = process.env.RUNTIME_TLS_REJECT_UNAUTHORIZED !== 'false'
  return { rejectUnauthorized: shouldReject }
}
