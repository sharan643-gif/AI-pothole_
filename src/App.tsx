import { Suspense, lazy, useEffect, useRef, type ReactNode } from 'react'
import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { Skeleton } from '@/components/ui/primitives'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { STORAGE_BUCKETS } from '@/lib/constants'
import { getRepository } from '@/services'
import type { PendingReport } from '@/services/offline'
import Home from '@/pages/Home'
import LiveScan from '@/pages/LiveScan'
import Login from '@/pages/Login'
import NotFound from '@/pages/NotFound'
import Profile from '@/pages/Profile'
import Reports from '@/pages/Reports'
import Scan from '@/pages/Scan'
import ScanResult from '@/pages/ScanResult'
import type { UserRole } from '@/types'

// Map rendering (MapLibre) and charting (Recharts) are heavy. Loading them on
// demand keeps the first paint of the scan flow fast on mobile networks.
const AdminDashboard = lazy(() => import('@/pages/AdminDashboard'))
const GlobePage = lazy(() => import('@/pages/GlobePage'))
const MapPage = lazy(() => import('@/pages/MapPage'))
const OfficerDashboard = lazy(() => import('@/pages/OfficerDashboard'))
const ReportDetail = lazy(() => import('@/pages/ReportDetail'))

/**
 * Application routing.
 *
 * The camera flow owns the entire viewport; every other screen lives inside the
 * floating-tab-bar shell.
 */
export default function App() {
  return (
    <>
      <OfflineSync />
      <Routes>
        <Route path="/login" element={<Login />} />

        {/* Camera owns the full frame */}
        <Route
          path="/scan"
          element={
            <RequireAuth>
              <Scan />
            </RequireAuth>
          }
        />

        {/* Real-time detection mode — also full-bleed */}
        <Route
          path="/scan/live"
          element={
            <RequireAuth>
              <LiveScan />
            </RequireAuth>
          }
        />

        {/* Result screen keeps the shell but hides the tab bar */}
        <Route
          element={
            <RequireAuth>
              <PageShell nav={false} />
            </RequireAuth>
          }
        >
          <Route path="/scan/result" element={<ScanResult />} />
        </Route>

        <Route
          element={
            <RequireAuth>
              <PageShell />
            </RequireAuth>
          }
        >
          <Route path="/" element={<Home />} />
          <Route
            path="/map"
            element={
              <Lazy>
                <MapPage />
              </Lazy>
            }
          />
          <Route
            path="/globe"
            element={
              <Lazy>
                <GlobePage />
              </Lazy>
            }
          />
          <Route path="/reports" element={<Reports />} />
          <Route
            path="/reports/:id"
            element={
              <Lazy>
                <ReportDetail />
              </Lazy>
            }
          />
          <Route path="/profile" element={<Profile />} />
          <Route
            path="/officer"
            element={
              <RoleGate roles={['OFFICER', 'ADMIN', 'SUPERVISOR']}>
                <Lazy>
                  <OfficerDashboard />
                </Lazy>
              </RoleGate>
            }
          />
          <Route
            path="/admin"
            element={
              <RoleGate roles={['ADMIN', 'SUPERVISOR']}>
                <Lazy>
                  <AdminDashboard />
                </Lazy>
              </RoleGate>
            }
          />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </>
  )
}

function PageShell({ nav = true }: { nav?: boolean }) {
  return (
    <AppShell nav={nav}>
      <Outlet />
    </AppShell>
  )
}

/** Suspense boundary with an in-frame skeleton so layout does not jump. */
function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<RouteSkeleton />}>{children}</Suspense>
}

function RouteSkeleton() {
  return (
    <div className="space-y-3 px-4 pt-4">
      <Skeleton className="h-7 w-44" />
      <Skeleton className="h-32" />
      <Skeleton className="h-48" />
      <p className="text-center text-[11px] text-white/40">Loading module…</p>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Guards
 * ------------------------------------------------------------------ */

function RequireAuth({ children }: { children: ReactNode }) {
  const { userId, loading } = useAuth()

  if (loading) return <SplashScreen />
  if (!userId) return <Navigate to="/login" replace />

  return <>{children}</>
}

function RoleGate({ roles, children }: { roles: UserRole[]; children: ReactNode }) {
  const { role, loading } = useAuth()
  if (loading) return <SplashScreen />
  if (!roles.includes(role)) return <Navigate to="/" replace />
  return <>{children}</>
}

function SplashScreen() {
  return (
    <div className="flex min-h-svh items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-3">
        <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-aurora-400 to-aurora-600 text-lg font-bold text-ink-950">
          RG
        </div>
        <Skeleton className="mx-auto h-4 w-40" />
        <Skeleton className="mx-auto h-3 w-28" />
        <p className="text-center text-[11px] text-white/40">Loading RoadGuard AI…</p>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Offline queue drain (spec section 37)
 * ------------------------------------------------------------------ */

function OfflineSync() {
  const toast = useToast()
  const { userId } = useAuth()
  const repo = getRepository()
  const drained = useRef(false)

  /** Upload one queued report and dispatch an officer for it. */
  const upload = async (report: PendingReport) => {
    let imageUrl: string | null = null

    if (report.imageDataUrl && userId) {
      try {
        imageUrl = await repo.uploadImage({
          dataUrl: report.imageDataUrl,
          bucket: STORAGE_BUCKETS.potholeImages,
          kind: 'queued',
          userId,
        })
      } catch {
        // Storage unavailable (missing configuration or a policy rejection). The
        // report is still filed and the capture stays on the device.
        imageUrl = null
      }
    }

    const pothole = await repo.createPothole({
      latitude: report.latitude,
      longitude: report.longitude,
      imageUrl,
      imageDataUrl: report.imageDataUrl,
      analysis: report.analysis,
      priority: report.priority,
      roadType: report.roadType,
      nearSchool: report.nearSchool,
      nearHospital: report.nearHospital,
      nearIntersection: report.nearIntersection,
      notes: report.notes ?? undefined,
    })

    // Dispatch is best-effort: the report is already durable.
    await repo.assignOfficer(pothole.id).catch(() => undefined)
  }

  const { online, queued } = useOnlineStatus({ onFlush: upload })

  useEffect(() => {
    if (!online) {
      drained.current = false
      return
    }
    if (queued > 0) {
      drained.current = false
      return
    }
    if (!drained.current) {
      drained.current = true
      toast.success('Offline queue synced', 'All locally saved reports have been uploaded.')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, queued])

  return null
}
