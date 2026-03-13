/**
 * WebRTC Chunked Message Protocol
 *
 * Transparently splits large messages into chunks for WebRTC data channel
 * transmission (which has a ~16KB per-message limit). Small messages are
 * sent directly with zero overhead.
 *
 * Chunk protocol:
 *   { type: "chunk_start", transfer_id, total_chunks, total_size }
 *   { type: "chunk_data",  transfer_id, sequence, data }
 *   { type: "chunk_end",   transfer_id }
 */

/** Messages smaller than this (bytes) are sent directly */
const CHUNK_THRESHOLD = 15_000

/** Max payload per chunk_data message (bytes, leaves room for JSON wrapper) */
const CHUNK_PAYLOAD_SIZE = 14_000

/** Resume sending when bufferedAmount drops below this */
const BUFFER_LOW_WATER_MARK = 65_536

/** Safety limits to prevent memory exhaustion from malformed/buggy messages */
const MAX_TOTAL_CHUNKS = 10_000
const MAX_TOTAL_SIZE = 100_000_000 // 100 MB

let transferCounter = 0

function nextTransferId(): string {
  transferCounter = (transferCounter + 1) % 1_000_000
  return `${Date.now()}-${transferCounter}`
}

/**
 * Send a message string over a WebRTC data channel, automatically chunking
 * if the payload exceeds CHUNK_THRESHOLD.
 */
export async function sendChunkedMessage(channel: RTCDataChannel, message: string): Promise<void> {
  if (message.length < CHUNK_THRESHOLD) {
    channel.send(message)
    return
  }

  const transferId = nextTransferId()
  const totalChunks = Math.ceil(message.length / CHUNK_PAYLOAD_SIZE)

  // Send chunk_start
  channel.send(
    JSON.stringify({
      type: 'chunk_start',
      transfer_id: transferId,
      total_chunks: totalChunks,
      total_size: message.length,
    }),
  )

  // Send chunk_data with backpressure management
  for (let seq = 0; seq < totalChunks; seq++) {
    const start = seq * CHUNK_PAYLOAD_SIZE
    const data = message.slice(start, start + CHUNK_PAYLOAD_SIZE)

    // Wait for buffer to drain if it's getting full
    if (channel.bufferedAmount > BUFFER_LOW_WATER_MARK) {
      await waitForBufferDrain(channel)
    }

    channel.send(
      JSON.stringify({
        type: 'chunk_data',
        transfer_id: transferId,
        sequence: seq,
        data,
      }),
    )
  }

  // Send chunk_end
  channel.send(
    JSON.stringify({
      type: 'chunk_end',
      transfer_id: transferId,
    }),
  )
}

/**
 * Wait for the data channel's send buffer to drain below the low-water mark.
 */
function waitForBufferDrain(channel: RTCDataChannel): Promise<void> {
  return new Promise<void>((resolve) => {
    channel.bufferedAmountLowThreshold = BUFFER_LOW_WATER_MARK
    const onBufferLow = () => {
      channel.removeEventListener('bufferedamountlow', onBufferLow)
      resolve()
    }
    channel.addEventListener('bufferedamountlow', onBufferLow)

    // Safety: if buffer is already below threshold, resolve immediately
    if (channel.bufferedAmount <= BUFFER_LOW_WATER_MARK) {
      channel.removeEventListener('bufferedamountlow', onBufferLow)
      resolve()
    }
  })
}

interface InFlightTransfer {
  chunks: string[]
  received: number
  totalChunks: number
  totalSize: number
  startedAt: number
}

/**
 * Reassembles chunked messages received over a WebRTC data channel.
 *
 * Feed each incoming parsed message via `handleChunkMessage()`.
 * Returns the complete reassembled string when `chunk_end` arrives,
 * or `null` if the message is a partial chunk.
 */
export class ChunkReassembler {
  private transfers = new Map<string, InFlightTransfer>()

  /**
   * Returns true if the message type is a chunk protocol message.
   */
  isChunkMessage(msgType: string): boolean {
    return msgType === 'chunk_start' || msgType === 'chunk_data' || msgType === 'chunk_end'
  }

  /**
   * Process a chunk protocol message.
   *
   * @returns The fully reassembled message string when complete, or null if still accumulating.
   */
  handleChunkMessage(msg: { type: string; transfer_id: string; [key: string]: unknown }): string | null {
    const transferId = msg.transfer_id

    if (msg.type === 'chunk_start') {
      const totalChunks = msg.total_chunks as number
      const totalSize = msg.total_size as number

      if (totalChunks <= 0 || totalChunks > MAX_TOTAL_CHUNKS || totalSize <= 0 || totalSize > MAX_TOTAL_SIZE) {
        console.warn(
          `[WebRTC] Rejecting chunk transfer ${transferId}: invalid bounds (chunks=${totalChunks}, size=${totalSize})`,
        )
        return null
      }

      this.transfers.set(transferId, {
        chunks: new Array(totalChunks),
        received: 0,
        totalChunks,
        totalSize,
        startedAt: Date.now(),
      })
      return null
    }

    if (msg.type === 'chunk_data') {
      const transfer = this.transfers.get(transferId)
      if (!transfer) {
        console.warn(`[WebRTC] Received chunk_data for unknown transfer: ${transferId}`)
        return null
      }
      const sequence = msg.sequence as number
      if (sequence < 0 || sequence >= transfer.totalChunks) {
        console.warn(
          `[WebRTC] Out-of-range sequence ${sequence} for transfer ${transferId} (totalChunks=${transfer.totalChunks})`,
        )
        return null
      }
      if (transfer.chunks[sequence] === undefined) {
        transfer.received++
      }
      transfer.chunks[sequence] = msg.data as string
      return null
    }

    if (msg.type === 'chunk_end') {
      const transfer = this.transfers.get(transferId)
      if (!transfer) {
        console.warn(`[WebRTC] Received chunk_end for unknown transfer: ${transferId}`)
        return null
      }

      this.transfers.delete(transferId)

      if (transfer.received !== transfer.totalChunks) {
        console.warn(
          `[WebRTC] Incomplete chunk transfer ${transferId}: expected ${transfer.totalChunks} chunks, received ${transfer.received}`,
        )
        return null
      }

      const assembled = transfer.chunks.join('')
      return assembled
    }

    return null
  }

  /**
   * Clean up any stale transfers older than the given timeout (ms).
   */
  cleanupStale(timeoutMs: number = 60_000): void {
    const now = Date.now()
    for (const [id, transfer] of this.transfers) {
      if (now - transfer.startedAt > timeoutMs) {
        console.warn(`[WebRTC] Cleaning up stale chunk transfer: ${id}`)
        this.transfers.delete(id)
      }
    }
  }
}
