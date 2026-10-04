import { type ReactNode } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { SEVERITY_META } from '@/lib/constants'
import { cn } from '@/lib/utils'
import type { Severity } from '@/types'
import { GlassCard } from '@/components/ui/primitives'

/**
 * Charting lives in its own module so Recharts (~400 kB) is only downloaded by
 * the routes that actually render charts.
 */

const TOOLTIP_STYLE = {
  background: 'rgba(10,14,26,0.94)',
  border: '1px solid rgba(255,255,255,0.14)',
  borderRadius: 12,
  fontSize: 12,
  color: '#fff',
  padding: '8px 10px',
} as const

const AXIS_TICK = { fill: 'rgba(255,255,255,0.45)', fontSize: 10 } as const

export function ChartFrame({
  title,
  subtitle,
  children,
  className,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  className?: string
}) {
  return (
    <GlassCard className={cn('space-y-3', className)}>
      <div>
        <h3 className="text-[13px] font-semibold tracking-tight text-white">{title}</h3>
        {subtitle ? <p className="text-[11px] text-white/45">{subtitle}</p> : null}
      </div>
      <div className="h-[190px] w-full">{children}</div>
    </GlassCard>
  )
}

export function SeverityDonut({ data }: { data: { severity: Severity; count: number }[] }) {
  const total = data.reduce((sum, row) => sum + row.count, 0)

  return (
    <ChartFrame title="Potholes by severity" subtitle={`${total} incidents in view`}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="count"
            nameKey="severity"
            innerRadius="58%"
            outerRadius="86%"
            paddingAngle={3}
            stroke="none"
          >
            {data.map((row) => (
              <Cell key={row.severity} fill={SEVERITY_META[row.severity].hex} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(value, name) => [
              String(value),
              SEVERITY_META[String(name) as Severity]?.label ?? String(name),
            ]}
          />
        </PieChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}

export function ZoneBarChart({
  data,
  title = 'Potholes by zone',
}: {
  data: { zone: string; count: number; critical: number }[]
  title?: string
}) {
  return (
    <ChartFrame title={title} subtitle="Grouped from live incident coordinates">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.07)" vertical={false} />
          <XAxis dataKey="zone" tick={AXIS_TICK} axisLine={false} tickLine={false} />
          <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
          <Bar dataKey="count" name="Total" fill="#2ea8e0" radius={[6, 6, 0, 0]} />
          <Bar
            dataKey="critical"
            name="Critical"
            fill={SEVERITY_META.CRITICAL.hex}
            radius={[6, 6, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}

export function TrendAreaChart({
  data,
  title = 'Monthly incidents',
}: {
  data: { label: string; count: number; resolved: number }[]
  title?: string
}) {
  return (
    <ChartFrame title={title} subtitle="Reported vs resolved">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
          <defs>
            <linearGradient id="reportedFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4cc9f0" stopOpacity={0.55} />
              <stop offset="100%" stopColor="#4cc9f0" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="resolvedFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#30d158" stopOpacity={0.5} />
              <stop offset="100%" stopColor="#30d158" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(255,255,255,0.07)" vertical={false} />
          <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} />
          <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          <Area
            type="monotone"
            dataKey="count"
            name="Reported"
            stroke="#4cc9f0"
            strokeWidth={2}
            fill="url(#reportedFill)"
          />
          <Area
            type="monotone"
            dataKey="resolved"
            name="Resolved"
            stroke="#30d158"
            strokeWidth={2}
            fill="url(#resolvedFill)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}

export function StatusBarChart({
  data,
}: {
  data: { status: string; count: number; tone: string }[]
}) {
  return (
    <ChartFrame title="Workflow distribution" subtitle="Where incidents currently sit">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 24, bottom: 0 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.07)" horizontal={false} />
          <XAxis
            type="number"
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <YAxis
            type="category"
            dataKey="status"
            width={78}
            tick={{ fill: 'rgba(255,255,255,0.55)', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
          <Bar dataKey="count" name="Incidents" radius={[0, 6, 6, 0]}>
            {data.map((row) => (
              <Cell key={row.status} fill={row.tone} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}

export function OfficerWorkloadChart({
  data,
}: {
  data: { name: string; active: number; completed: number }[]
}) {
  if (data.length === 0) {
    return (
      <ChartFrame title="Officer workload" subtitle="No assignments recorded yet">
        <div className="flex h-full items-center justify-center text-[12px] text-white/40">
          No assignment data
        </div>
      </ChartFrame>
    )
  }

  return (
    <ChartFrame title="Officer workload" subtitle="Active vs completed jobs">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.07)" vertical={false} />
          <XAxis dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} />
          <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
          <Bar dataKey="active" name="Active" stackId="a" fill="#ff9f0a" />
          <Bar dataKey="completed" name="Completed" stackId="a" fill="#30d158" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}
