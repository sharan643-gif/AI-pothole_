/**
 * Google Gemini client.
 *
 * The API key is read from the function's secrets at request time and never
 * returned to the client.
 */

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

export const DEFAULT_MODEL = 'gemini-3.5-flash-lite'

export interface InlineImage {
  mimeType: string
  base64: string
  /** Purely informational — helps the model reason about capture modality. */
  role?: 'before' | 'after' | 'primary'
}

export interface GenerateOptions {
  prompt: string
  images?: InlineImage[]
  model?: string
  temperature?: number
  /** Ask the model to emit strict JSON. */
  json?: boolean
  timeoutMs?: number
}

export class GeminiError extends Error {
  readonly status: number
  constructor(message: string, status = 502) {
    super(message)
    this.name = 'GeminiError'
    this.status = status
  }
}

export function geminiApiKey(): string {
  const key = Deno.env.get('GEMINI_API_KEY')
  if (!key) throw new GeminiError('GEMINI_API_KEY is not configured.', 500)
  return key
}

/** Calls generateContent and returns the raw text of the first candidate. */
export async function generateText(options: GenerateOptions): Promise<string> {
  const key = geminiApiKey()
  const model = options.model ?? Deno.env.get('GEMINI_MODEL') ?? DEFAULT_MODEL

  const parts: Record<string, unknown>[] = []
  for (const image of options.images ?? []) {
    parts.push({
      inline_data: { mime_type: image.mimeType, data: image.base64 },
    })
  }
  parts.push({ text: options.prompt })

  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: options.temperature ?? 0.2,
      topP: 0.9,
      maxOutputTokens: 2048,
      ...(options.json === false
        ? {}
        : { responseMimeType: 'application/json' as const }),
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
    ],
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 45000)

  try {
    const res = await fetch(
      `${API_BASE}/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    )

    if (!res.ok) {
      const detail = await res.text()
      throw new GeminiError(
        `Gemini responded ${res.status}: ${detail.slice(0, 400)}`,
        res.status === 429 ? 429 : 502,
      )
    }

    const payload = await res.json()
    const candidate = payload?.candidates?.[0]
    const finish = candidate?.finishReason
    const text = candidate?.content?.parts
      ?.map((p: { text?: string }) => p.text ?? '')
      .join('')
      .trim()

    if (!text) {
      throw new GeminiError(
        `Gemini returned no usable content (finishReason: ${finish ?? 'unknown'}).`,
      )
    }
    return text
  } catch (error) {
    if (error instanceof GeminiError) throw error
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new GeminiError('Gemini request timed out.', 504)
    }
    throw new GeminiError(
      `Gemini request failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Pull the first balanced JSON object out of a model response. Models
 * occasionally wrap JSON in prose or markdown fences despite instructions.
 */
export function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced?.[1] ?? raw
  const start = candidate.indexOf('{')
  if (start === -1) throw new GeminiError('Model response contained no JSON object.')
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < candidate.length; i += 1) {
    const char = candidate[i]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        try {
          return JSON.parse(candidate.slice(start, i + 1))
        } catch (error) {
          throw new GeminiError(
            `Model returned unparseable JSON: ${error instanceof Error ? error.message : error}`,
          )
        }
      }
    }
  }
  throw new GeminiError('Model returned an unbalanced JSON object.')
}

// ---------------------------------------------------------------------
// Image loading
// ---------------------------------------------------------------------

const MAX_IMAGE_BYTES = 12 * 1024 * 1024
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic'])

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/** Fetch a (usually signed) URL and inline it for the model. */
export async function imageFromUrl(
  url: string,
  role?: InlineImage['role'],
): Promise<InlineImage> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new GeminiError(`Could not download image (${res.status}).`, 422)
  }
  const contentType = (res.headers.get('content-type') ?? 'image/jpeg')
    .split(';')[0]
    .trim()
    .toLowerCase()
  if (!ALLOWED_MIME.has(contentType)) {
    throw new GeminiError(`Unsupported image type: ${contentType}`, 415)
  }
  const buffer = new Uint8Array(await res.arrayBuffer())
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new GeminiError('Image exceeds the 12 MB analysis limit.', 413)
  }
  return { mimeType: contentType, base64: toBase64(buffer), role }
}

export function imageFromBase64(
  base64: string,
  mimeType = 'image/jpeg',
  role?: InlineImage['role'],
): InlineImage {
  const data = base64.includes(',') ? base64.split(',').pop()! : base64
  return { mimeType, base64: data, role }
}
