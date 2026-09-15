/**
 * JARVIS Local Offline Ollama Engine.
 *
 * Runs 100% locally on your PC without external API keys or cloud dependencies.
 * Uses Ollama's native /api/chat endpoint with streaming text deltas and function calling.
 */

import { GEMINI_TOOLS, createToolExecutor } from './gemini.mjs'

/**
 * Converts Gemini tool definitions into native Ollama/OpenAI JSON Schema format.
 */
export function convertToOllamaTools(tools) {
  function convert(p) {
    if (!p) return { type: 'object', properties: {} }
    const out = { ...p, type: (p.type || 'object').toLowerCase() }
    if (p.properties) {
      out.properties = {}
      for (const [k, v] of Object.entries(p.properties)) out.properties[k] = convert(v)
    }
    if (p.items) {
      out.items = convert(p.items)
    }
    return out
  }
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: convert(t.parameters),
    },
  }))
}

export const OLLAMA_TOOLS = convertToOllamaTools(GEMINI_TOOLS)

/**
 * Creates an offline Ollama chat session for a connected JARVIS client.
 */
export function createOllamaSession({
  send,
  ask,
  sendTurn,
  announceTool,
  settleTool,
  systemPrompt,
  modelName,
  host = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434',
}) {
  const model = modelName || process.env.OLLAMA_MODEL || 'qwen2.5:7b'
  const executeTool = createToolExecutor({ send, announceTool, settleTool, ask })
  const history = []
  let activeAbort = null
  let cancelled = false

  console.log(`[ollama-bridge] Initialized local session using model: ${model} on ${host}`)

  return {
    async handleAsk(userText, askId) {
      cancelled = false
      activeAbort = new AbortController()
      let fullText = ''
      history.push({ role: 'user', content: userText })

      try {
        const now = new Date()
        const liveClock = `\n\nCurrent Real-Time System Clock: ${now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}, ${now.toLocaleTimeString('en-US', { hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: true })} (Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}). You have direct real-time access to the user's PC clock, hardware, and files.`

        const messages = [
          { role: 'system', content: systemPrompt + liveClock },
          ...history.slice(-12),
        ]

        let toolLoops = 5
        while (toolLoops-- > 0) {
          if (cancelled || activeAbort.signal.aborted) break

          const res = await fetch(`${host}/api/chat`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              model,
              messages,
              tools: OLLAMA_TOOLS,
              stream: true,
              options: {
                temperature: 0.7,
              },
            }),
            signal: activeAbort.signal,
          })

          if (!res.ok) {
            const errBody = await res.text()
            if (res.status === 404) {
              throw new Error(`Model '${model}' not found in local Ollama. Please run: ollama run ${model}`)
            }
            throw new Error(`Ollama error (${res.status}): ${errBody}`)
          }

          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ''
          let assistantMsg = { role: 'assistant', content: '', tool_calls: [] }

          while (true) {
            if (cancelled || activeAbort.signal.aborted) break
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() || ''

            for (const line of lines) {
              if (!line.trim()) continue
              try {
                const chunk = JSON.parse(line)
                if (chunk.message?.content) {
                  const token = chunk.message.content
                  assistantMsg.content += token
                  fullText += token
                  send({ type: 'delta', delta: token })
                  sendTurn({ type: 'text', delta: token })
                }
                if (chunk.message?.tool_calls?.length) {
                  assistantMsg.tool_calls.push(...chunk.message.tool_calls)
                }
              } catch {
                // partial json line
              }
            }
          }

          if (cancelled || activeAbort.signal.aborted) return

          // If the model called any tools
          if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
            messages.push(assistantMsg)
            for (const call of assistantMsg.tool_calls) {
              if (cancelled) break
              const fnName = call.function.name
              let fnArgs = call.function.arguments || {}
              if (typeof fnArgs === 'string') {
                try {
                  fnArgs = JSON.parse(fnArgs)
                } catch {
                  fnArgs = {}
                }
              }
              console.log(`[ollama-bridge] Executing local tool: ${fnName}`, fnArgs)
              const toolResult = await executeTool(fnName, fnArgs, askId)
              messages.push({
                role: 'tool',
                content: JSON.stringify(toolResult),
              })
            }
            // Loop again so the local model provides a spoken answer explaining the tool outcome
            continue
          }

          // Complete turn
          history.push({ role: 'assistant', content: fullText.trim() })
          sendTurn({
            type: 'done',
            text: fullText.trim(),
            model: `ollama:${model}`,
          })
          return
        }
      } catch (err) {
        if (err.name === 'AbortError' || cancelled) {
          console.log('[ollama-bridge] Turn cancelled or aborted.')
          return
        }
        console.error('[ollama-bridge] Turn error:', err)
        let friendlyMsg = err.message
        if (friendlyMsg.includes('ECONNREFUSED') || friendlyMsg.includes('fetch failed')) {
          friendlyMsg = 'Local Ollama service is not running. Please start Ollama or run ollama serve.'
        }
        sendTurn({
          type: 'error',
          message: friendlyMsg,
        })
      } finally {
        activeAbort = null
      }
    },

    interrupt() {
      cancelled = true
      if (activeAbort) {
        try {
          activeAbort.abort()
        } catch {
          /* noop */
        }
        activeAbort = null
      }
    },

    close() {
      this.interrupt()
    },
  }
}
