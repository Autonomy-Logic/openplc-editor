import { type AIPort, AIRequestError } from '../../../middleware/shared/ports/ai-port'
import { openPLCStoreBase } from '../../store'
import type { ProjectStTranspiler } from './graphical-context'
import { executeTool, type ToolResult } from './tools'
import type { BillingErrorPayload } from './types'
import type { AIChatContentBlock, AIChatMessage, AIChatRequest, AIToolDefinition } from './types'

/** Events emitted by the agentic loop to the UI */
export type AgenticEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call_start'; toolId: string; toolName: string }
  | { type: 'tool_call_complete'; toolId: string; toolName: string; result: ToolResult }
  /**
   * Emitted at the end of an iteration's assistant turn (after text streamed
   * and tool calls were collected). Carries the full block array — text +
   * tool_use blocks — so the panel can freeze the streaming message into a
   * persistable shape.
   */
  | { type: 'iteration_assistant_complete'; blocks: AIChatContentBlock[] }
  /**
   * Emitted after tool_call_complete events for the iteration, with the
   * tool_result blocks the loop will send on the next /ai/chat call. The
   * panel persists these as a user-role message so reload reproduces the
   * agentic-loop transcript.
   */
  | { type: 'iteration_tool_results_complete'; blocks: AIChatContentBlock[] }
  /**
   * Backend created a new conversation for this turn (the request had
   * `projectId` but no `conversationId`). Forwarded verbatim from the
   * SSE stream so the panel can stash the id in the slice and attach it
   * on iteration 2+.
   */
  | { type: 'conversation_started'; conversationId: string; conversationTitle: string }
  | { type: 'done' }
  /**
   * Error during the stream. `billing` is populated when an `AIRequestError`
   * with a parsed 402 payload bubbled up from `streamAIRequest` — the chat
   * panel writes it onto `ai.billingError` so the exhaustion modal pops.
   */
  | { type: 'error'; error: string; billing?: BillingErrorPayload }

/** Everything the loop needs beyond the transport and the request itself. */
export type AgenticLoopOptions = {
  /** Cancels the in-flight turn and stops the loop between iterations. */
  signal?: AbortSignal
  /**
   * Turns the whole project into ST, for tools that have to read a diagram.
   * Platform-supplied because the transpiler runs on a Web Worker in the browser
   * and in the main process on the desktop. Absent means a graphical POU reports
   * that its ST is unavailable rather than reporting an empty body.
   */
  transpileProject?: ProjectStTranspiler
  /**
   * Runs one tool call. Defaults to the project's own executor, which acts on
   * the live store. Injectable so the loop can be exercised — and, later, gated
   * — without standing up a project.
   */
  runTool?: (toolName: string, toolInput: unknown) => Promise<ToolResult>
}

/**
 * Run an agentic chat loop that handles tool use.
 *
 * Flow:
 * 1. Ask the port for a chat turn with messages + tools
 * 2. Stream response (text tokens + tool_use blocks)
 * 3. If Claude calls tools: execute them, build tool_result messages
 * 4. Ask again with updated conversation (assistant response + tool results)
 * 5. Repeat until Claude responds with only text (no tool calls)
 *
 * The transport arrives as `ai` rather than being imported: this module is shared
 * between the desktop and the web, and the two reach the same API by different
 * routes (fetch + SSE in the browser, IPC to the main process on the desktop).
 * `streamChatEvents` is the method it consumes — NOT `streamChat`, which flattens
 * the stream to prose and would drop every `tool_use` frame, leaving a loop that
 * looks like it answered while building nothing.
 */
export async function* runAgenticLoop(
  ai: AIPort,
  request: AIChatRequest,
  tools: AIToolDefinition[],
  options: AgenticLoopOptions = {},
): AsyncGenerator<AgenticEvent, void, unknown> {
  const { signal, transpileProject, runTool } = options
  const callTool = runTool ?? ((name: string, input: unknown) => executeTool(name, input, { transpileProject }))
  let currentMessages: AIChatMessage[] = [...request.messages]

  while (true) {
    if (signal?.aborted) return

    // Re-read conversationId from the slice on every iteration. The first
    // iteration may not have one (backend then creates a new conversation and
    // emits `conversation_started`, which the panel folds into the slice).
    // Iteration 2+ must attach that id so tool-result turns persist into the
    // SAME conversation instead of spawning a new one per round trip.
    const currentConversationId = openPLCStoreBase.getState().ai.conversationId
    const fullRequest: AIChatRequest = {
      ...request,
      messages: currentMessages,
      tools,
      ...(currentConversationId ? { conversationId: currentConversationId } : {}),
    }

    // Collect text and tool_use events from this iteration
    let textAccumulated = ''
    const toolCalls: Array<{ id: string; name: string; input: unknown }> = []

    try {
      for await (const event of ai.streamChatEvents(fullRequest, signal)) {
        if (signal?.aborted) return

        if (event.type === 'conversation_started') {
          yield {
            type: 'conversation_started',
            conversationId: event.conversationId,
            conversationTitle: event.conversationTitle,
          }
        }

        if (event.type === 'content_block_delta') {
          textAccumulated += event.delta
          yield { type: 'text_delta', text: event.delta }
        }

        if (event.type === 'tool_use') {
          toolCalls.push({ id: event.id, name: event.name, input: event.input })
        }

        if (event.type === 'message_stop') {
          if (toolCalls.length === 0) {
            const finalBlocks: AIChatContentBlock[] = textAccumulated ? [{ type: 'text', text: textAccumulated }] : []
            if (finalBlocks.length > 0) {
              yield { type: 'iteration_assistant_complete', blocks: finalBlocks }
            }
            yield { type: 'done' }
            return
          }
        }
      }
    } catch (error) {
      const billing = error instanceof AIRequestError ? error.billing : undefined
      yield {
        type: 'error',
        error: error instanceof Error ? error.message : 'Stream error',
        ...(billing ? { billing } : {}),
      }
      return
    }

    // If no tool calls were made, we're done.
    // Emit iteration_assistant_complete so the panel can freeze the
    // streamed text into a block-form message even on text-only turns.
    if (toolCalls.length === 0) {
      const finalBlocks: AIChatContentBlock[] = textAccumulated ? [{ type: 'text', text: textAccumulated }] : []
      if (finalBlocks.length > 0) {
        yield { type: 'iteration_assistant_complete', blocks: finalBlocks }
      }
      yield { type: 'done' }
      return
    }

    // Build the assistant message with text + tool_use blocks
    const assistantContent: AIChatContentBlock[] = []
    if (textAccumulated) {
      assistantContent.push({ type: 'text', text: textAccumulated })
    }
    for (const tc of toolCalls) {
      assistantContent.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.name,
        input: tc.input,
      })
    }

    yield { type: 'iteration_assistant_complete', blocks: assistantContent }

    // Execute each tool and build tool_result blocks
    const toolResults: AIChatContentBlock[] = []
    for (const tc of toolCalls) {
      yield { type: 'tool_call_start', toolId: tc.id, toolName: tc.name }

      const result = await callTool(tc.name, tc.input)

      yield { type: 'tool_call_complete', toolId: tc.id, toolName: tc.name, result }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: tc.id,
        content: result.message,
        is_error: !result.success,
      })
    }

    yield { type: 'iteration_tool_results_complete', blocks: toolResults }

    // Append assistant message and tool results to the conversation
    currentMessages = [
      ...currentMessages,
      { role: 'assistant', content: assistantContent },
      { role: 'user', content: toolResults },
    ]
  }
}
