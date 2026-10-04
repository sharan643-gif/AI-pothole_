import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Pothole } from '@/types'
import {
  DepthConfidencePanel,
  MeasurementGrid,
  PotholeCard,
  PriorityBadge,
  SeverityBadge,
  StatusBadge,
  StatusTimeline,
} from './PotholeComponents'

const POTHOLE: Pothole = {
  id: 'p1',
  incident_code: 'PTH-1042',
  reported_by: 'u1',
  latitude: 12.9716,
  longitude: 77.5946,
  address: 'MG Road, Bengaluru, Karnataka',
  image_url: null,
  width_cm: 85,
  length_cm: 120,
  depth_cm: 9.2,
  area_cm2: 10200,
  depth_method: 'MONOCULAR_DEPTH_ESTIMATION',
  depth_confidence: 0.72,
  measurement_confidence: 0.78,
  ai_confidence: 0.94,
  severity: 'CRITICAL',
  priority_score: 92,
  priority_level: 'CRITICAL',
  traffic_risk: 'HIGH',
  vehicle_risk: 'HIGH',
  road_damage_type: 'POTHOLE',
  recommended_action: 'URGENT_REPAIR',
  status: 'EN_ROUTE',
  zone: 'ZONE-03',
  road_type: 'ARTERIAL',
  near_school: true,
  near_hospital: false,
  near_intersection: true,
  report_count: 2,
  notes: null,
  created_at: new Date(Date.now() - 120_000).toISOString(),
  updated_at: new Date().toISOString(),
}

describe('badges', () => {
  it('renders severity with a colour-coded label', () => {
    render(<SeverityBadge severity="CRITICAL" />)
    expect(screen.getByText('Critical')).toBeInTheDocument()
  })

  it('renders the priority band with its numeric score', () => {
    render(<PriorityBadge level="CRITICAL" score={92} />)
    expect(screen.getByText('P1')).toBeInTheDocument()
    expect(screen.getByText('92')).toBeInTheDocument()
  })

  it('renders a human-readable status', () => {
    render(<StatusBadge status="AI_VERIFICATION" />)
    expect(screen.getByText('AI verification')).toBeInTheDocument()
  })
})

describe('MeasurementGrid', () => {
  it('formats measurements with units', () => {
    render(<MeasurementGrid pothole={POTHOLE} />)
    expect(screen.getByText('85 cm')).toBeInTheDocument()
    expect(screen.getByText('120 cm')).toBeInTheDocument()
    expect(screen.getByText('9.2 cm')).toBeInTheDocument()
    expect(screen.getByText('1.02 m²')).toBeInTheDocument()
    expect(screen.getByText('94%')).toBeInTheDocument()
    expect(screen.getByText('92/100')).toBeInTheDocument()
  })

  it('shows an em dash rather than inventing a missing measurement', () => {
    render(<MeasurementGrid pothole={{ ...POTHOLE, depth_cm: null, area_cm2: null }} />)
    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBeGreaterThanOrEqual(2)
  })
})

describe('DepthConfidencePanel (spec sections 5 and 56)', () => {
  it('labels a sensor-derived depth as measured', () => {
    render(
      <DepthConfidencePanel
        depthCm={8.4}
        method="AR_DEPTH_SENSOR"
        depthConfidence={0.88}
        measurementConfidence={0.9}
        source="sensor_samples"
      />,
    )
    expect(screen.getByText('Measured depth')).toBeInTheDocument()
    expect(screen.getByText('Sensor-derived')).toBeInTheDocument()
    expect(screen.queryByText('Approximate')).not.toBeInTheDocument()
  })

  it('labels a visual estimate as approximate and explains why', () => {
    render(
      <DepthConfidencePanel
        depthCm={9.2}
        method="VISION_ESTIMATE"
        depthConfidence={0.41}
        measurementConfidence={0.45}
        source="visual_estimate"
      />,
    )
    expect(screen.getByText('Estimated depth')).toBeInTheDocument()
    expect(screen.getByText('Approximate')).toBeInTheDocument()
    expect(
      screen.getByText(/cannot yield absolute scale/i),
    ).toBeInTheDocument()
  })

  it('never renders a measurement when depth is unknown', () => {
    render(
      <DepthConfidencePanel
        depthCm={null}
        method="UNKNOWN"
        depthConfidence={null}
        measurementConfidence={null}
      />,
    )
    expect(screen.getByText('Estimated depth')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})

describe('PotholeCard', () => {
  it('summarises an incident and is keyboard operable', () => {
    const onSelect = vi.fn()
    render(<PotholeCard pothole={POTHOLE} onSelect={onSelect} distanceKm={1.8} />)

    expect(screen.getByText('PTH-1042')).toBeInTheDocument()
    expect(screen.getByText(/MG Road/)).toBeInTheDocument()
    expect(screen.getByText('1.80 km away')).toBeInTheDocument()

    const button = screen.getByRole('button')
    button.click()
    expect(onSelect).toHaveBeenCalledOnce()
  })
})

describe('StatusTimeline', () => {
  it('advances with the incident status', () => {
    render(<StatusTimeline status="ON_SITE" />)
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(9)
    const onSite = screen.getByText('On site')
    expect(within(onSite.parentElement as HTMLElement).getByText(/officer has arrived/i)).toBeInTheDocument()
  })
})
