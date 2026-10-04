import { Compass, Home } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Screen, TopBar } from '@/components/layout/AppShell'
import { Button, GlassCard } from '@/components/ui/primitives'

export default function NotFound() {
  const navigate = useNavigate()

  return (
    <>
      <TopBar title="Not found" back />
      <Screen>
        <GlassCard className="space-y-3 text-center">
          <Compass className="mx-auto h-7 w-7 text-white/40" aria-hidden />
          <div>
            <p className="text-[16px] font-semibold text-white">This page does not exist</p>
            <p className="mt-1 text-[12px] text-white/50">
              The route you followed is not part of RoadGuard AI.
            </p>
          </div>
          <Button onClick={() => navigate('/')} icon={<Home className="h-4 w-4" />}>
            Back to dashboard
          </Button>
        </GlassCard>
      </Screen>
    </>
  )
}
