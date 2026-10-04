import { useEffect, useId, useRef } from 'react'
import { CAPABILITIES } from '@/lib/config'
import { supabase } from '@/lib/supabase'

/**
 * Supabase Realtime subscription (spec section 23).
 *
 * Without credentials this is a no-op rather than a silent fake — the UI simply
 * does not claim to be live.
 */

export interface RealtimeChange {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE'
  new: Record<string, unknown>
  old: Record<string, unknown>
}

export function useRealtimeTable(
  table: string,
  onChange: (change: RealtimeChange) => void,
  options: { filter?: string; enabled?: boolean; channel?: string } = {},
): void {
  const callbackRef = useRef(onChange)

  // Syncing in an effect (rather than during render) keeps the subscription
  // stable and satisfies the React Compiler's ref rules.
  useEffect(() => {
    callbackRef.current = onChange
  }, [onChange])

  const enabled = (options.enabled ?? true) && CAPABILITIES.realtime && supabase !== null
  const { filter, channel: channelName } = options

  /**
   * supabase-js returns the SAME channel for a repeated topic, so two hooks
   * watching the same table (e.g. the dashboard's stats and list) would share
   * one channel and the second `.on()` would throw "cannot add callbacks after
   * subscribe()". A per-instance suffix keeps every subscription independent.
   */
  const instanceId = useId().replace(/[^a-zA-Z0-9]/g, '')
  const topic = channelName ?? `roadguard:${table}:${filter ?? 'all'}:${instanceId}`

  useEffect(() => {
    if (!enabled || !supabase) return

    let channel: ReturnType<typeof supabase.channel> | null = null
    try {
      channel = supabase
        .channel(topic)
        .on(
          // Types for postgres_changes are loose in supabase-js; the payload is
          // normalised below into RealtimeChange.
          'postgres_changes' as never,
          {
            event: '*',
            schema: 'public',
            table,
            ...(filter ? { filter } : {}),
          } as never,
          (payload: unknown) => {
            const typed = payload as {
              eventType?: string
              new?: Record<string, unknown>
              old?: Record<string, unknown>
            }
            callbackRef.current({
              eventType: (typed.eventType ?? 'UPDATE') as RealtimeChange['eventType'],
              new: typed.new ?? {},
              old: typed.old ?? {},
            })
          },
        )
        .subscribe()
    } catch (error) {
      // A live-update subscription is an enhancement: if it cannot be created
      // the screen must still render with its initial data. Throwing here would
      // unmount the whole React tree and blank the dashboard.
      console.warn('[realtime] subscription failed:', error)
      return
    }

    return () => {
      if (channel) void supabase?.removeChannel(channel)
    }
  }, [table, filter, enabled, topic])
}
