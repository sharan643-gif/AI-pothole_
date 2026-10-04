import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A missing Edge Function deployment returns HTTP 404 with
 * {"code":"NOT_FOUND","message":"Requested function was not found"} from the
 * Supabase runtime. supabase-js surfaces that as a generic "Failed to send a
 * request to the Edge Function", which reads like a network fault and sends
 * people debugging the wrong thing. These tests pin the correct mapping.
 */
const state = vi.hoisted(() => ({
  invoke: vi.fn(),
  fetch: vi.fn(),
}))

vi.mock('@/lib/config', () => ({ SUPABASE_URL: 'https://project.supabase.co' }))

vi.stubGlobal('fetch', (...args: unknown[]) => state.fetch(...args))

vi.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => state.invoke(...args) } },
  requireSupabase: () => ({
    functions: { invoke: (...args: unknown[]) => state.invoke(...args) },
  }),
  isSupabaseReady: () => true,
}))

import { AppError } from '@/lib/errors'
import { LiveRepository } from './live'

const input = {
  fix: { latitude: 12.9716, longitude: 77.5946 },
  roadType: 'ARTERIAL' as const,
  imageDataUrl: 'data:image/jpeg;base64,AAAA',
}

describe('LiveRepository — edge function failures', () => {
  beforeEach(() => {
    state.invoke.mockReset()
    state.fetch.mockReset()
  })

  it('reports an undeployed function as a configuration problem, not a network error', async () => {
    state.invoke.mockResolvedValue({
      data: null,
      error: {
        name: 'FunctionsHttpError',
        message: 'Failed to send a request to the Edge Function',
        context: new Response(
          JSON.stringify({ code: 'NOT_FOUND', message: 'Requested function was not found' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } },
        ),
      },
    })

    const repo = new LiveRepository()

    await expect(repo.analyze(input)).rejects.toMatchObject({
      code: 'CONFIG_MISSING',
    })

    try {
      await repo.analyze(input)
    } catch (error) {
      const appError = error as AppError
      expect(appError.message).toMatch(/not deployed/i)
      expect(appError.userMessage).toMatch(/deployed/i)
    }
  })

  it('maps an explicit AI_FAILED envelope to an AI failure', async () => {
    state.invoke.mockResolvedValue({
      data: null,
      error: {
        name: 'FunctionsHttpError',
        message: 'Edge Function returned a non-2xx status code',
        context: new Response(
          JSON.stringify({ ok: false, error: { code: 'AI_FAILED', message: 'Gemini timed out.' } }),
          { status: 502, headers: { 'Content-Type': 'application/json' } },
        ),
      },
    })

    const repo = new LiveRepository()
    await expect(repo.analyze(input)).rejects.toMatchObject({ code: 'AI_FAILED' })
  })

  it('detects an undeployed function even when CORS hides the 404 from the POST', async () => {
    // A missing function rejects the preflight, so supabase-js reports a bare
    // fetch failure with no Response attached.
    state.invoke.mockResolvedValue({
      data: null,
      error: {
        name: 'FunctionsFetchError',
        message: 'Failed to send a request to the Edge Function',
      },
    })
    // The preflight-free probe can still read the real status.
    state.fetch.mockResolvedValue(new Response('', { status: 404 }))

    const repo = new LiveRepository()
    await expect(repo.analyze(input)).rejects.toMatchObject({ code: 'CONFIG_MISSING' })
    expect(state.fetch).toHaveBeenCalled()
  })

  it('keeps a genuine offline failure as a network error', async () => {
    state.invoke.mockResolvedValue({
      data: null,
      error: { name: 'FunctionsFetchError', message: 'Failed to send a request' },
    })
    state.fetch.mockRejectedValue(new TypeError('Failed to fetch'))

    const repo = new LiveRepository()
    await expect(repo.analyze(input)).rejects.toMatchObject({ code: 'NETWORK_FAILED' })
  })

  it('maps an auth-guard rejection to AUTH_REQUIRED', async () => {
    state.invoke.mockResolvedValue({
      data: null,
      error: {
        name: 'FunctionsHttpError',
        message: 'Edge Function returned a non-2xx status code',
        context: new Response(
          JSON.stringify({
            ok: false,
            error: { code: 'AUTH_REQUIRED', message: 'Sign in to use this endpoint.' },
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        ),
      },
    })

    const repo = new LiveRepository()
    await expect(repo.analyze(input)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
  })
})