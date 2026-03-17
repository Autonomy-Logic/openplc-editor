/**
 * Runtime API service stubs.
 * These functions will be implemented when the runtime API integration is built.
 */

export function runtimeGetUsersInfo(
  _orchestratorAgentId: string,
  _deviceId: string,
): Promise<{ error?: string; hasUsers: boolean }> {
  return Promise.resolve({ hasUsers: false })
}

export async function runtimeLogout(
  _orchestratorAgentId: string,
  _deviceId: string,
  _jwtToken: string,
): Promise<void> {
  // Stub
}
