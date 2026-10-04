import { LiveRepository } from './live'
import type { Repository } from './types'

export type * from './types'

let instance: Repository | null = null

/**
 * Resolve the active repository.
 *
 * RoadGuard AI is live-only: every read and write goes to the configured
 * Supabase project. There is no bundled sample dataset, so nothing on screen
 * can ever be mistaken for real civic data.
 */
export function getRepository(): Repository {
  if (!instance) instance = new LiveRepository()
  return instance
}

export { LiveRepository }
