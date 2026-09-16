import { type AIPort, AIRequestError } from '../../../middleware/shared/ports/ai-port'
import { openPLCStoreBase } from '../../store'
import type { ProjectStTranspiler } from './graphical-context'
import { executeTool, type ToolResult } from './tools'
import type { BillingErrorPayload } from './types'
import type { AIChatContentBlock, AIChatMessage, AIChatRequest, AIToolDefinition } from './types'

export type AgenticEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call_start'; toolId: string; toolName: string }
  | { type: 'tool_call_complete'; toolId: string; toolName: string; result: ToolResult }
  /** Carries the full block array (text + tool_use) so the panel can freeze the streamed message. */
  | { type: 'iteration_assistant_complete'; blocks: AIChatContentBlock[] }
  /** The tool_result blocks the loop sends on the next /ai/chat call, persisted so reload reproduces the transcript. */
  | { type: 'iteration_tool_results_complete'; blocks: AIChatContentBlock[] }
  /** Backend created a new conversation for this turn; the panel stashes the id and attaches it from iteration 2+. */
  | { type: 'conversation_started'; conversationId: string; conversationTitle: string }
  | { type: 'done' }
  /** `billing` is populated from a parsed 402 payload so the exhaustion modal can pop. */
  | { type: 'error'; error: string; billing?: BillingErrorPayload; status?: number }

export type AgenticLoopOptions = {
  /** Cancels the in-flight turn and stops the loop between iterations. */
  signal?: AbortSignal
  /** Platform-supplied; absent means a graphical POU reports ST as unavailable. */
  transpileProject?: ProjectStTranspiler
  /** Defaults to the project's own executor; injectable so the loop can be exercised without a live project. */
  runTool?: (toolName: string, toolInput: unknown) => Promise<ToolResult>
}

/** Runs the agentic chat loop; must consume `ai.streamChatEvents`, not `streamChat`, which drops tool_use frames. */
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

    // Re-read on every iteration, or a later round trip spawns a new conversation instead of continuing this one.
    const currentConversationId = openPLCStoreBase.getState().ai.conversationId
    const fullRequest: AIChatRequest = {
      ...request,
      messages: currentMessages,
      tools,
      ...(currentConversationId ? { conversationId: currentConversationId } : {}),
    }

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
        // The panel needs the status to tell a refused session (401) from a failed answer.
        ...(error instanceof AIRequestError ? { status: error.status } : {}),
      }
      return
    }

    // Freezes streamed text into block form even on text-only turns, so the panel state stays consistent.
    if (toolCalls.length === 0) {
      const finalBlocks: AIChatContentBlock[] = textAccumulated ? [{ type: 'text', text: textAccumulated }] : []
      if (finalBlocks.length > 0) {
        yield { type: 'iteration_assistant_complete', blocks: finalBlocks }
      }
      yield { type: 'done' }
      return
    }

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

    currentMessages = [
      ...currentMessages,
      { role: 'assistant', content: assistantContent },
      { role: 'user', content: toolResults },
    ]
  }
}
