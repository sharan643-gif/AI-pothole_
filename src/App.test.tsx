import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

/**
 * Whole-app render tests for the signed-in routes.
 *
 * A crash inside a data hook (for example an unsubscribed realtime channel)
 * unmounts the entire tree and leaves a blank screen, which no unit test would
 * catch. These tests render the real App with a stubbed backend so that class
 * of regression fails loudly here instead of in the browser.
 */
const backend = vi.hoisted(() => {
  const session = {
    user: { id: 'user-1', email: 'citizen@example.com', user_metadata: {} },
    access_token: 'token',
  }
  const profile: Record<string, unknown> = {
    id: 'user-1',
    full_name: 'Test Citizen',
    email: 'citizen@example.com',
    phone: null,
    role: 'CITIZEN',
    avatar_url: null,
    created_at: new Date().toISOString(),
  }
  const rows: Record<string, unknown[]> = {
    potholes: [],
    officers: [],
    assignments: [],
    notifications: [],
    repair_records: [],
    severity_config: [],
    scan_queue: [],
    pothole_analysis: [],
  }

  function builder(table: string) {
    const single =
      table === 'profiles' ? { data: profile, error: null } : { data: null, error: null }
    const many = { data: rows[table] ?? [], error: null }
    const api: Record<string, unknown> = {}
    const chain = () => api
    for (const method of [
      'select',
      'eq',
      'in',
      'or',
      'gte',
      'lte',
      'gt',
      'neq',
      'order',
      'limit',
      'update',
      'insert',
      'delete',
      'match',
    ]) {
      api[method] = chain
    }
    api.maybeSingle = async () => single
    api.single = async () => single
    api.then = (resolve: (value: unknown) => unknown) => Promise.resolve(many).then(resolve)
    return api
  }

  const channelInstance: Record<string, unknown> = {}
  channelInstance.on = () => channelInstance
  channelInstance.subscribe = () => channelInstance
  channelInstance.unsubscribe = () => {}

  const client = {
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        queueMicrotask(() => cb('SIGNED_IN', session))
        return { data: { subscription: { unsubscribe: () => {} } } }
      },
      getUser: async () => ({ data: { user: session.user }, error: null }),
      signOut: async () => ({ error: null }),
    },
    from: (table: string) => builder(table),
    rpc: async () => ({
      data: {
        total: 0,
        critical: 0,
        inRepair: 0,
        resolved: 0,
        resolvedToday: 0,
        avgResolutionHours: null,
      },
      error: null,
    }),
    channel: () => channelInstance,
    removeChannel: async () => 'ok',
    functions: { invoke: async () => ({ data: {}, error: null }) },
    storage: {
      from: () => ({
        createSignedUrl: async () => ({ data: null, error: null }),
        upload: async () => ({ error: null }),
      }),
    },
  }

  return { client, profile }
})

vi.mock('@/lib/supabase', () => ({
  supabase: backend.client,
  requireSupabase: () => backend.client,
  isSupabaseReady: () => true,
}))

vi.mock('@/services/offline', () => ({
  countQueuedReports: async () => 0,
  flushQueue: async () => null,
}))

import App from './App'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { AuthProvider } from '@/context/AuthContext'
import { ScanSessionProvider } from '@/context/ScanContext'
import { ToastProvider } from '@/context/ToastContext'

function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ErrorBoundary>
        <AuthProvider>
          <ToastProvider>
            <ScanSessionProvider>
              <App />
            </ScanSessionProvider>
          </ToastProvider>
        </AuthProvider>
      </ErrorBoundary>
    </MemoryRouter>,
  )
}

describe('App — signed-in routes', () => {
  beforeEach(() => {
    backend.profile.role = 'CITIZEN'
  })

  it('renders the citizen dashboard instead of a blank screen', async () => {
    renderApp('/')

    expect(await screen.findByText(/Road Safety Dashboard/i, undefined, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.getByText('START AI SCAN')).toBeInTheDocument()
  })

  it('navigates from a top pill bar rather than a sidebar', async () => {
    renderApp('/')

    const primary = await screen.findByRole('navigation', { name: 'Primary' })
    expect(within(primary).getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/')
    expect(within(primary).getByRole('link', { name: 'Reports' })).toHaveAttribute(
      'href',
      '/reports',
    )
    // The old left-hand rail must be gone on desktop.
    expect(screen.queryByRole('complementary', { name: 'Sidebar' })).not.toBeInTheDocument()
  })

  it('renders the officer dashboard for an officer', async () => {
    backend.profile.role = 'OFFICER'
    renderApp('/officer')

    // The officer console is a lazy-loaded chunk, so allow for a cold import.
    expect(
      await screen.findByText(/Officer dashboard/i, undefined, { timeout: 5000 }),
    ).toBeInTheDocument()
  })
})
