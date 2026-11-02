/**
 * Mechanisms behind runtime commercial licence delivery.
 *
 * All behaviour is shared (`utils/licensing/runtime-license-sync.ts`). A platform
 * supplies only transports, which make no decisions and pass replies verbatim.
 */

/** An HTTP reply as received: the status code and the body, as text or already-parsed JSON. */
export interface RawHttpReply {
  status: number
  body: unknown
}

export interface RuntimeLicenseMechanisms {
  /** Authenticated GET of a path on the connected runtime's REST API. Throws on a transport failure. */
  runtimeGet(path: string): Promise<RawHttpReply>
  /** Authenticated POST of a JSON value to the connected runtime's REST API. Throws on a transport failure. */
  runtimePost(path: string, json: Record<string, unknown>): Promise<RawHttpReply>
  /** POST of a JSON value to a path on the Edge API. Throws on a transport failure. */
  edgePost(path: string, json: Record<string, unknown>): Promise<RawHttpReply>
}
