import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { AppShell, Canvas, Screen, TopBar } from './AppShell'

/**
 * The shell reads the signed-in role from AuthContext. We mock it so these
 * navigation tests stay deterministic and never depend on a live Supabase
 * session or a bundled sample dataset.
 */
const authState = vi.hoisted(() => ({
  role: 'CITIZEN' as 'CITIZEN' | 'OFFICER' | 'ADMIN' | 'SUPERVISOR',
}))

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    profile: {
      id: `user-${authState.role.toLowerCase()}`,
      full_name: 'Test User',
      email: 'test@roadguard.app',
      role: authState.role,
    },
    role: authState.role,
    signOut: vi.fn(),
  }),
}))

function renderShell(children: React.ReactNode = <p>content</p>, path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppShell>{children}</AppShell>
    </MemoryRouter>,
  )
}

/**
 * The shell renders both navigation presentations and lets CSS pick one:
 * a glass sidebar rail at lg and above, a floating tab bar below it. Both stay
 * mounted so the breakpoint switch never remounts or loses state.
 */
describe('AppShell', () => {
  beforeEach(() => {
    authState.role = 'CITIZEN'
  })

  it('renders the top pill navigation with the brand and primary action', () => {
    renderShell()

    const primary = screen.getByRole('navigation', { name: 'Primary' })
    expect(screen.getByText('RoadGuard AI')).toBeInTheDocument()
    expect(within(primary).getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('button', { name: /start ai scan/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument()
  })

  it('renders the floating tab bar labelled independently of the sidebar', () => {
    renderShell()

    const tabBar = screen.getByRole('navigation', { name: 'Tab bar' })
    expect(within(tabBar).getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/')
    expect(within(tabBar).getByRole('link', { name: 'Scan' })).toHaveAttribute('href', '/scan')
    expect(within(tabBar).getByRole('link', { name: 'Me' })).toHaveAttribute('href', '/profile')
  })

  it('marks the current section for assistive technology', () => {
    renderShell(<p>content</p>, '/reports')

    const primary = screen.getByRole('navigation', { name: 'Primary' })
    expect(within(primary).getByRole('link', { name: /reports/i })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('does not offer admin sections to a citizen', () => {
    renderShell()
    const primary = screen.getByRole('navigation', { name: 'Primary' })
    expect(within(primary).queryByRole('link', { name: /admin/i })).not.toBeInTheDocument()
    expect(within(primary).queryByRole('link', { name: /officer/i })).not.toBeInTheDocument()
  })

  it('adds role-specific sections for an officer', () => {
    authState.role = 'OFFICER'
    renderShell()

    const primary = screen.getByRole('navigation', { name: 'Primary' })
    expect(within(primary).getByRole('link', { name: /officer/i })).toHaveAttribute(
      'href',
      '/officer',
    )
    expect(within(primary).queryByRole('link', { name: /admin/i })).not.toBeInTheDocument()
  })

  it('adds the analytics console for an administrator', () => {
    authState.role = 'ADMIN'
    renderShell()

    const primary = screen.getByRole('navigation', { name: 'Primary' })
    expect(within(primary).getByRole('link', { name: /admin/i })).toHaveAttribute(
      'href',
      '/admin',
    )
  })

  it('hides navigation on camera and result screens', () => {
    render(
      <MemoryRouter>
        <AppShell nav={false}>
          <p>content</p>
        </AppShell>
      </MemoryRouter>,
    )
    expect(screen.queryByRole('navigation', { name: 'Primary' })).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Tab bar' })).not.toBeInTheDocument()
    expect(screen.getByText('content')).toBeInTheDocument()
  })

  it('renders children inside the scrollable content panel', () => {
    renderShell(<h1>Dashboard content</h1>)
    expect(screen.getByText('Dashboard content')).toBeInTheDocument()
  })
})

describe('Canvas', () => {
  it('renders children on a liquid-glass panel over the ambient backdrop', () => {
    const { container } = render(
      <Canvas width="sm" panel>
        <p>standalone screen</p>
      </Canvas>,
    )
    expect(screen.getByText('standalone screen')).toBeInTheDocument()
    expect(container.querySelector('.liquid')).not.toBeNull()
  })

  it('does not paint a panel when none is requested', () => {
    const { container } = render(
      <Canvas width="sm">
        <p>plain</p>
      </Canvas>,
    )
    expect(container.querySelector('.liquid-deep')).toBeNull()
  })
})

describe('TopBar and Screen', () => {
  it('exposes a heading, subtitle and back control', () => {
    render(
      <MemoryRouter>
        <TopBar title="Reports" subtitle="12 records" back />
        <Screen>
          <p>body</p>
        </Screen>
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: 'Reports' })).toBeInTheDocument()
    expect(screen.getByText('12 records')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Go back' })).toBeInTheDocument()
  })
})
