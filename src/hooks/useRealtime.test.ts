import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

/**
 * Reproduces supabase-js channel semantics: `channel(topic)` returns the same
 * channel for a repeated topic, and adding a callback after `subscribe()`
 * throws. The dashboard hits exactly this by subscribing to `potholes` twice
 * (once for stats, once for the incident list).
 */
const fake = vi.hoisted(() => {
  const channels = new Map<string, { subscribed: boolean }>()
  return {
    channels,
    channel(topic: string) {
      const state = channels.get(topic) ?? { subscribed: false }
      channels.set(topic, state)
      const channel: Record<string, unknown> = {}
      channel.on = () => {
        if (state.subscribed) {
          throw new Error(`cannot add callbacks after subscribe() for ${topic}`)
        }
        return channel
      }
      channel.subscribe = () => {
        state.subscribed = true
        return channel
      }
      return channel
    },
  }
})

vi.mock('@/lib/supabase', () => ({
  supabase: {
    channel: (topic: string) => fake.channel(topic),
    removeChannel: () => Promise.resolve('ok'),
  },
}))

vi.mock('@/lib/config', () => ({ CAPABILITIES: { realtime: true } }))

import { useRealtimeTable } from './useRealtime'

describe('useRealtimeTable', () => {
  it('gives concurrent subscriptions to the same table independent channels', () => {
    fake.channels.clear()

    renderHook(() => {
      useRealtimeTable('potholes', vi.fn())
      useRealtimeTable('potholes', vi.fn())
    })

    expect(fake.channels.size).toBe(2)
    for (const [topic, state] of fake.channels) {
      expect(topic.startsWith('roadguard:potholes:all')).toBe(true)
      expect(state.subscribed).toBe(true)
    }
  })
})
