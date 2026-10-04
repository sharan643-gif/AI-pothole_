import { motion } from 'framer-motion'
import {
  ArrowRight,
  Bell,
  Camera,
  HardHat,
  Lock,
  Mail,
  MapPin,
  Navigation,
  ScanLine,
  ShieldCheck,
  User,
  Users,
  Wrench,
} from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Canvas } from '@/components/layout/AppShell'
import { LiquidGlass } from '@/components/ui/LiquidGlass'
import { Button, Segmented } from '@/components/ui/primitives'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { APP_NAME, APP_TAGLINE } from '@/lib/constants'
import { loginSchema } from '@/lib/schemas'
import { cn } from '@/lib/utils'

type Segment = 'PUBLIC' | 'OFFICER'

/**
 * The two account segments. Each one lists the features that role actually
 * uses, and (for sign-up) the role the account is created with. Only CITIZEN
 * and OFFICER can be self-selected — admin roles stay admin-granted.
 */
const SEGMENTS = {
  PUBLIC: {
    label: 'Public',
    icon: Users,
    role: 'CITIZEN' as const,
    tagline: 'Report road damage where you are and follow it until it is fixed.',
    landing: '/',
    features: [
      {
        icon: ScanLine,
        title: 'Scan in one tap',
        body: 'Gemini measures the pothole and the priority engine explains the score.',
      },
      {
        icon: Bell,
        title: 'Track every report',
        body: 'Follow the status from reported to assigned to resolved, with notifications.',
      },
      {
        icon: MapPin,
        title: 'Live incident map',
        body: 'See verified damage near you on the map and 3D globe before you drive.',
      },
    ],
  },
  OFFICER: {
    label: 'Officer',
    icon: HardHat,
    role: 'OFFICER' as const,
    tagline: 'Work the repairs assigned to your zone and close them out with proof.',
    landing: '/officer',
    features: [
      {
        icon: Wrench,
        title: 'Assignment queue',
        body: 'Accept the incidents dispatched to you by priority and distance.',
      },
      {
        icon: Navigation,
        title: 'Navigate to the site',
        body: 'Distance, ETA and the exact location for every assigned pothole.',
      },
      {
        icon: Camera,
        title: 'AI repair verification',
        body: 'Submit a before/after photo pair and let Gemini verify the repair.',
      },
    ],
  },
} as const

export default function Login() {
  const navigate = useNavigate()
  const toast = useToast()
  const { signIn, signUp, signInWithGoogle } = useAuth()

  const [segment, setSegment] = useState<Segment>('PUBLIC')
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [busy, setBusy] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const active = SEGMENTS[segment]

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setFieldErrors({})

    const parsed = loginSchema.safeParse({ email, password })
    if (!parsed.success) {
      const errors: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        errors[String(issue.path[0])] = issue.message
      }
      setFieldErrors(errors)
      return
    }

    setBusy(true)
    try {
      if (mode === 'signin') {
        await signIn(email, password)
        toast.success('Signed in', `Welcome back to ${APP_NAME}.`)
        navigate(active.landing, { replace: true })
      } else {
        const { needsConfirmation } = await signUp(email, password, fullName, active.role)
        if (needsConfirmation) {
          toast.success(
            'Confirm your email',
            'Check your inbox to confirm the address, then sign in.',
          )
        } else {
          toast.success(
            `${active.label} account created`,
            active.role === 'OFFICER'
              ? 'Your officer profile is ready — assignments will appear in your queue.'
              : 'You are signed in.',
          )
          navigate(active.landing, { replace: true })
        }
      }
    } catch (error) {
      toast.error(
        mode === 'signin' ? 'Sign-in failed' : 'Sign-up failed',
        error instanceof Error ? error.message : 'Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Canvas width="xl">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pt-10 pb-10 lg:items-center lg:justify-center lg:px-12">
        <div className="w-full lg:grid lg:max-w-5xl lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-14">
          {/* ------------------------------------------------- hero (desktop) */}
          <motion.section
            initial={{ opacity: 0, x: -18 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ type: 'spring', stiffness: 200, damping: 26 }}
            className="hidden lg:flex lg:flex-col lg:gap-8"
          >
            <div>
              <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-[1.4rem] bg-gradient-to-br from-aurora-400 to-aurora-600 text-2xl font-bold text-ink-950 shadow-[0_20px_60px_-18px_rgba(76,201,240,0.95)]">
                RG
              </div>
              <h1 className="text-[40px] leading-[1.05] font-semibold tracking-tight text-white">
                {APP_NAME}
              </h1>
              <p className="mt-2.5 text-[15px] text-white/55">{APP_TAGLINE}</p>
            </div>

            <ul className="space-y-5">
              {active.features.map((item) => (
                <li key={item.title} className="flex gap-3.5">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/8 ring-1 ring-white/10">
                    <item.icon className="h-4 w-4 text-aurora-300" aria-hidden />
                  </span>
                  <span>
                    <span className="block text-[13.5px] font-medium text-white/90">
                      {item.title}
                    </span>
                    <span className="mt-0.5 block max-w-sm text-[12.5px] leading-relaxed text-white/45">
                      {item.body}
                    </span>
                  </span>
                </li>
              ))}
            </ul>

            <p className="flex items-start gap-2 border-t border-white/8 pt-5 text-[11px] leading-relaxed text-white/35">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              Depth is reported as an estimate with an explicit confidence unless real depth data
              or a scale reference is available. This platform never presents a guess as a
              measurement.
            </p>
          </motion.section>

          {/* --------------------------------------------------------- form */}
          <section className="space-y-4">
            {/* Mobile brand lockup */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 220, damping: 26 }}
              className="mb-2 text-center lg:hidden"
            >
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-[1.4rem] bg-gradient-to-br from-aurora-400 to-aurora-600 text-2xl font-bold text-ink-950 shadow-[0_18px_50px_-16px_rgba(76,201,240,0.9)]">
                RG
              </div>
              <h1 className="text-[27px] font-semibold tracking-tight text-white">{APP_NAME}</h1>
              <p className="mt-1 text-[12px] text-white/50">{APP_TAGLINE}</p>
            </motion.div>

            {/* Account segment — Public or Officer */}
            <div className="space-y-2">
              <Segmented
                ariaLabel="Account type"
                value={segment}
                onChange={(value) => setSegment(value)}
                options={[
                  {
                    value: 'PUBLIC',
                    label: 'Public',
                    icon: <Users className="h-3.5 w-3.5" aria-hidden />,
                  },
                  {
                    value: 'OFFICER',
                    label: 'Officer',
                    icon: <HardHat className="h-3.5 w-3.5" aria-hidden />,
                  },
                ]}
              />
              <p className="px-1 text-[11px] leading-relaxed text-white/45">{active.tagline}</p>
            </div>

            <Segmented
              ariaLabel="Authentication mode"
              value={mode}
              onChange={(value) => setMode(value)}
              options={[
                { value: 'signin', label: 'Sign in' },
                { value: 'signup', label: 'Create account' },
              ]}
            />

            <LiquidGlass className="space-y-3.5 overflow-hidden rounded-ios p-4 lg:p-5">
              <form onSubmit={handleSubmit} className="space-y-3.5" noValidate>
                {mode === 'signup' ? (
                  <Field
                    id="fullName"
                    label="Full name"
                    icon={<User className="h-4 w-4" aria-hidden />}
                    value={fullName}
                    onChange={setFullName}
                    placeholder="Ananya Sharma"
                    autoComplete="name"
                  />
                ) : null}

                <Field
                  id="email"
                  label="Email"
                  type="email"
                  icon={<Mail className="h-4 w-4" aria-hidden />}
                  value={email}
                  onChange={setEmail}
                  placeholder="you@example.com"
                  autoComplete="email"
                  error={fieldErrors.email}
                />

                <Field
                  id="password"
                  label="Password"
                  type="password"
                  icon={<Lock className="h-4 w-4" aria-hidden />}
                  value={password}
                  onChange={setPassword}
                  placeholder="••••••••"
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  error={fieldErrors.password}
                />

                <Button
                  type="submit"
                  size="lg"
                  fullWidth
                  loading={busy}
                  icon={<ArrowRight className="h-4 w-4" />}
                >
                  {mode === 'signin' ? `Sign in as ${active.label}` : `Create ${active.label} account`}
                </Button>
              </form>

              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-white/10" aria-hidden />
                <span className="text-[10px] tracking-wider text-white/35 uppercase">or</span>
                <span className="h-px flex-1 bg-white/10" aria-hidden />
              </div>

              <Button
                variant="secondary"
                fullWidth
                onClick={() => void signInWithGoogle()}
                icon={<GoogleGlyph />}
              >
                Continue with Google
              </Button>
            </LiquidGlass>

            {/* What this segment gets (mobile view) */}
            <ul className="space-y-2.5 lg:hidden">
              {active.features.map((item) => (
                <li key={item.title} className="flex gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/8 ring-1 ring-white/10">
                    <item.icon className="h-3.5 w-3.5 text-aurora-300" aria-hidden />
                  </span>
                  <span>
                    <span className="block text-[12.5px] font-medium text-white/90">
                      {item.title}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-relaxed text-white/45">
                      {item.body}
                    </span>
                  </span>
                </li>
              ))}
            </ul>

            <p className="pt-1 text-center text-[10px] leading-relaxed text-white/30">
              AI measurements are estimates, not certified engineering values. Repair verification
              is assistive and does not replace official inspection.
            </p>
          </section>
        </div>
      </div>
    </Canvas>
  )
}

function Field({
  id,
  label,
  icon,
  value,
  onChange,
  placeholder,
  type = 'text',
  autoComplete,
  error,
}: {
  id: string
  label: string
  icon: ReactNode
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
  autoComplete?: string
  error?: string
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[11px] font-medium text-white/55">
        {label}
      </label>
      <div
        className={cn(
          'flex items-center gap-2 rounded-2xl border bg-white/6 px-3 transition-colors focus-within:border-aurora-400/60',
          error ? 'border-red-400/50' : 'border-white/12',
        )}
      >
        <span className="text-white/35">{icon}</span>
        <input
          id={id}
          type={type}
          value={value}
          autoComplete={autoComplete}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          className="h-11 w-full bg-transparent text-[14px] text-white placeholder:text-white/25 focus:outline-none"
        />
      </div>
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-[11px] text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path
        fill="#EA4335"
        d="M12 10.2v3.9h5.5c-.24 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.7-6-6.2s2.7-6.2 6-6.2c1.9 0 3.1.8 3.9 1.5l2.7-2.6C16.9 3.1 14.7 2.2 12 2.2 6.6 2.2 2.2 6.6 2.2 12s4.4 9.8 9.8 9.8c5.7 0 9.4-4 9.4-9.6 0-.6-.06-1.1-.15-1.6H12z"
      />
    </svg>
  )
}
