import { describe, expect, it } from 'vitest'
import {
  lidarDepthProvider,
  monocularDepthProvider,
  referenceDepthProvider,
  resolveDepth,
  selectDepthProvider,
  stereoDepthProvider,
} from './depth'

describe('depth provider selection', () => {
  it('defaults to the monocular provider when nothing else is available', () => {
    expect(selectDepthProvider().kind).toBe('MONOCULAR')
    expect(selectDepthProvider({}).kind).toBe('MONOCULAR')
  })

  it('prefers LiDAR/LiDAR samples when a hint identifies them', () => {
    const provider = selectDepthProvider({
      depthSamplesCm: [8, 9, 10],
      depthMethodHint: 'AR_DEPTH_SENSOR',
    })
    expect(provider.kind).toBe('LIDAR')
  })

  it('prefers stereo/model depth over monocular when hinted', () => {
    const provider = selectDepthProvider({
      depthSamplesCm: [5, 6, 7],
      depthMethodHint: 'STEREO',
    })
    expect(provider.kind).toBe('STEREO')
  })

  it('uses a scale reference when present and no sensor samples exist', () => {
    const provider = selectDepthProvider({ referenceSizeCm: 30 })
    expect(provider.kind).toBe('REFERENCE')
  })

  it('ranks LiDAR above a scale reference when both are available', () => {
    const provider = selectDepthProvider({
      depthSamplesCm: [4, 5, 6],
      depthMethodHint: 'LIDAR',
      referenceSizeCm: 30,
    })
    expect(provider.kind).toBe('LIDAR')
  })
})

describe('depth estimate honesty', () => {
  it('reports LiDAR depth as measured, not estimated', () => {
    const estimate = resolveDepth({ depthSamplesCm: [10, 11, 12], depthMethodHint: 'AR_DEPTH_SENSOR' })
    expect(estimate.estimated).toBe(false)
    expect(estimate.method).toBe('AR_DEPTH_SENSOR')
    expect(estimate.depthCm).toBe(11)
    expect(estimate.confidence).toBeGreaterThan(0.5)
  })

  it('labels a single-frame depth as approximate and caps its confidence', () => {
    const estimate = monocularDepthProvider.estimate({
      visualDepthCm: 12,
      visualDepthConfidence: 0.95,
    })
    expect(estimate.estimated).toBe(true)
    expect(estimate.method).toBe('VISION_ESTIMATE')
    expect(estimate.confidence).toBeLessThanOrEqual(0.55)
  })

  it('returns a null depth (not a guess) when no signal exists', () => {
    const estimate = monocularDepthProvider.estimate({})
    expect(estimate.depthCm).toBeNull()
    expect(estimate.confidence).toBe(0)
  })

  it('treats a scale reference as calibrated but still estimated depth', () => {
    const estimate = referenceDepthProvider.estimate({
      referenceSizeCm: 30,
      visualDepthCm: 7,
    })
    expect(estimate.estimated).toBe(true)
    expect(estimate.method).toBe('REFERENCE_OBJECT')
    expect(estimate.depthCm).toBe(7)
  })

  it('ignores too few sensor samples and falls back to monocular', () => {
    expect(
      selectDepthProvider({ depthSamplesCm: [9], depthMethodHint: 'LIDAR' }).kind,
    ).toBe('MONOCULAR')
    expect(lidarDepthProvider.isAvailable({ depthSamplesCm: [9] })).toBe(false)
    expect(stereoDepthProvider.isAvailable({ depthSamplesCm: [] })).toBe(false)
  })
})
