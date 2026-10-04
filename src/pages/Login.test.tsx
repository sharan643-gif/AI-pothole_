import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

// Rendering the login screen must never require a live client or network.
vi.mock('@/lib/supabase', () => ({
  supabase: null,
  isSupabaseReady: () => false,
  requireSupabase: () => {
    throw new Error('Supabase is not configured in this test')
  },
}))

import { AuthProvider } from '@/context/AuthContext'
import { ToastProvider } from '@/context/ToastContext'
import Login from './Login'

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthProvider>
        <ToastProvider>
          <Login />
        </ToastProvider>
      </AuthProvider>
    </MemoryRouter>,
  )
}

describe('Login', () => {
  it('renders the sign-in form by default', () => {
    renderLogin()
    expect(screen.getByRole('tab', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Create account' })).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.queryByLabelText('Full name')).not.toBeInTheDocument()
  })

  it('switches to create-account and reveals the full-name field without crashing', async () => {
    const user = userEvent.setup()
    renderLogin()

    await user.click(screen.getByRole('tab', { name: 'Create account' }))

    expect(screen.getByLabelText('Full name')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create Public account' })).toBeInTheDocument()
  })

  it('offers Public and Officer segments on both sign-in and sign-up', async () => {
    const user = userEvent.setup()
    renderLogin()

    expect(screen.getByRole('tab', { name: 'Public' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Officer' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in as Public' })).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Officer' }))
    expect(screen.getByRole('button', { name: 'Sign in as Officer' })).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Create account' }))
    expect(screen.getByRole('button', { name: 'Create Officer account' })).toBeInTheDocument()
  })
})
