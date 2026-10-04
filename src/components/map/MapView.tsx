/**
 * MapView — Leaflet-powered map with satellite imagery.
 *
 * Tile providers (all free, no API key):
 *  • Satellite  → Esri World Imagery
 *  • Street     → CartoDB Dark Matter (matches app dark theme)
 *  • Labels     → Esri World Boundary & Places (overlay on satellite)
 *
 * Features:
 *  • Satellite / Street view toggle
 *  • Labels toggle (on satellite)
 *  • Pothole markers coloured by severity / status with popups
 *  • Officer markers
 *  • Animated user-location pulse marker
 *  • Heatmap overlay (leaflet.heat via canvas — built-in, no extra pkg)
 *  • Route polyline
 *  • Recenter / zoom controls
 *  • Legend + Heatmap toggle
 */

import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { Layers, Locate, Map as MapIcon, Satellite } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { DEFAULT_MAP_CENTER, SEVERITY_META } from '@/lib/constants'
import { cn } from '@/lib/utils'
import type { GeoFix, Officer, Pothole } from '@/types'

/* ─── fix default Leaflet icon paths broken by bundlers ─── */
;(L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl = undefined
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

/* ─── public types ─── */

export interface HeatCell {
  lat: number
  lon: number
  total: number
  critical: number
}

export interface MapViewProps {
  potholes: Pothole[]
  officers?: Officer[]
  userFix?: GeoFix | null
  heatmap?: boolean
  heatCells?: HeatCell[]
  selectedId?: string | null
  onSelect?: (p: Pothole) => void
  route?: [number, number][]
  center?: [number, number]   // [lat, lng]
  zoom?: number
  className?: string
  style?: React.CSSProperties
  interactive?: boolean
}

/* ─── tile layers ─── */

const TILE_LAYERS = {
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '© Esri, Maxar, Earthstar Geographics',
    maxZoom: 19,
  },
  street: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '© OpenStreetMap contributors © CARTO',
    maxZoom: 20,
  },
  labels: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    attribution: '© Esri',
    maxZoom: 19,
  },
}

/* ─── helpers ─── */

const RESOLVED_COLOR = '#8e8e93'

function markerColor(p: Pothole): string {
  if (p.status === 'RESOLVED') return RESOLVED_COLOR
  return SEVERITY_META[p.severity]?.hex ?? '#4cc9f0'
}

function makePotholeIcon(color: string, selected: boolean): L.DivIcon {
  const size = selected ? 22 : 16
  const ring = selected ? `box-shadow:0 0 0 6px ${color}33,0 0 22px ${color}99;` : `box-shadow:0 0 0 3px ${color}44,0 0 12px ${color}88;`
  return L.divIcon({
    className: '',
    iconAnchor: [size / 2, size / 2],
    html: `<span style="
      display:block;width:${size}px;height:${size}px;border-radius:50%;
      background:${color};${ring}
      border:${selected ? 2.5 : 1.8}px solid rgba(255,255,255,${selected ? 0.95 : 0.75});
      transition:transform .15s ease;
    "></span>`,
  })
}

function makeOfficerIcon(): L.DivIcon {
  return L.divIcon({
    className: '',
    iconAnchor: [14, 14],
    html: `<div style="
      width:28px;height:28px;display:flex;align-items:center;justify-content:center;
      background:rgba(13,15,26,0.85);border:1.5px solid rgba(255,255,255,0.65);
      border-radius:7px;font-size:15px;box-shadow:0 0 10px rgba(76,201,240,0.4);
      backdrop-filter:blur(6px);
    ">🧑‍🔧</div>`,
  })
}

function makeUserIcon(): L.DivIcon {
  return L.divIcon({
    className: '',
    iconAnchor: [12, 12],
    html: `<div style="position:relative;width:24px;height:24px;">
      <span class="rg-pulse"></span>
      <span style="
        position:absolute;top:4px;left:4px;
        width:16px;height:16px;border-radius:50%;background:#4cc9f0;
        border:2.5px solid #05070d;
        box-shadow:0 0 0 4px rgba(76,201,240,0.22),0 0 20px rgba(76,201,240,0.7);
      "></span>
    </div>`,
  })
}

/* ─── Heatmap canvas overlay (no external lib needed) ─── */

class HeatmapOverlay extends L.Layer {
  private _hCanvas: HTMLCanvasElement | null = null
  private _cells: HeatCell[] = []
  private _hMap: L.Map | null = null

  setCells(cells: HeatCell[]) {
    this._cells = cells
    this._draw()
  }

  onAdd(map: L.Map): this {
    this._hMap = map
    const canvas = document.createElement('canvas')
    canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;'
    const pane = map.getPane('overlayPane')
    if (pane) pane.appendChild(canvas)
    this._hCanvas = canvas
    map.on('moveend zoomend resize', this._draw, this)
    this._draw()
    return this
  }

  onRemove(map: L.Map): this {
    this._hCanvas?.remove()
    map.off('moveend zoomend resize', this._draw, this)
    this._hMap = null
    this._hCanvas = null
    return this
  }

  private _draw = () => {
    const map = this._hMap
    const canvas = this._hCanvas
    if (!map || !canvas) return

    const size = map.getSize()
    const dpr = window.devicePixelRatio || 1
    canvas.width = size.x * dpr
    canvas.height = size.y * dpr
    canvas.style.width = `${size.x}px`
    canvas.style.height = `${size.y}px`
    canvas.style.transform = 'translate3d(0,0,0)'

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.scale(dpr, dpr)

    const bounds = map.getBounds()
    for (const cell of this._cells) {
      if (!bounds.contains([cell.lat, cell.lon])) continue
      const pt = map.latLngToContainerPoint([cell.lat, cell.lon])
      const radius = Math.max(30, 60 / Math.pow(2, 14 - map.getZoom()))
      const weight = cell.critical > 0 ? 1 : 0.42
      const intensity = Math.min(1, (cell.total / 5) * weight)

      const grad = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, radius)
      const r = Math.round(255 * intensity)
      const g = Math.round(214 * (1 - intensity))
      grad.addColorStop(0,   `rgba(${r},${g},10,${0.65 * intensity})`)
      grad.addColorStop(0.5, `rgba(${r},${g},10,${0.28 * intensity})`)
      grad.addColorStop(1,   'rgba(255,69,58,0)')
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

/* ─── MapView component ─── */

type LayerMode = 'satellite' | 'street'

export function MapView({
  potholes,
  officers = [],
  userFix,
  heatmap = false,
  heatCells = [],
  selectedId,
  onSelect,
  route,
  center,
  zoom = 14,
  className,
  style,
  interactive = true,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const tileRef = useRef<L.TileLayer | null>(null)
  const labelsRef = useRef<L.TileLayer | null>(null)
  const markersRef = useRef<L.Marker[]>([])
  const officerMarkersRef = useRef<L.Marker[]>([])
  const userMarkerRef = useRef<L.Marker | null>(null)
  const routeRef = useRef<L.Polyline | null>(null)
  const heatRef = useRef<HeatmapOverlay | null>(null)

  const [layerMode, setLayerMode] = useState<LayerMode>('satellite')
  const [showLabels, setShowLabels] = useState(true)

  const defaultCenter: L.LatLngExpression = center ?? [DEFAULT_MAP_CENTER[1], DEFAULT_MAP_CENTER[0]]

  /* ── inject pulse animation CSS once ── */
  useEffect(() => {
    if (document.getElementById('rg-map-styles')) return
    const style = document.createElement('style')
    style.id = 'rg-map-styles'
    style.textContent = `
      .rg-pulse {
        position:absolute;top:0;left:0;width:24px;height:24px;border-radius:50%;
        border:2px solid rgba(76,201,240,0.6);
        animation:rg-pulse-anim 2s ease-out infinite;
      }
      @keyframes rg-pulse-anim {
        0%   { transform:scale(0.5); opacity:1; }
        100% { transform:scale(2.2); opacity:0; }
      }
      /* hide Leaflet default attribution (we keep it in legend) */
      .leaflet-control-attribution { font-size:9px !important; opacity:0.45 !important; }
      /* hide Leaflet default zoom (we use our own) */
      .leaflet-control-zoom { display:none !important; }
    `
    document.head.appendChild(style)
  }, [])

  /* ── map initialisation ── */
  useLayoutEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = L.map(containerRef.current, {
      center: defaultCenter,
      zoom,
      zoomControl: false,
      attributionControl: true,
      keyboard: interactive,
      dragging: interactive,
      scrollWheelZoom: interactive,
      doubleClickZoom: interactive,
      touchZoom: interactive,
    })

    /* base tile layer */
    const cfg = TILE_LAYERS.satellite
    const tile = L.tileLayer(cfg.url, {
      attribution: cfg.attribution,
      maxZoom: cfg.maxZoom,
      tileSize: 256,
    }).addTo(map)
    tileRef.current = tile

    /* labels overlay */
    const lblCfg = TILE_LAYERS.labels
    const lbl = L.tileLayer(lblCfg.url, {
      attribution: lblCfg.attribution,
      maxZoom: lblCfg.maxZoom,
      opacity: 0.85,
    }).addTo(map)
    labelsRef.current = lbl

    /* heatmap overlay */
    const heat = new HeatmapOverlay()
    heatRef.current = heat

    mapRef.current = map

    /* Leaflet measures the container during init; if React hasn't finished
       layout the size is 0×0 and tiles never load. Force a re-measure once
       the browser has painted the first frame. */
    const raf = requestAnimationFrame(() => {
      map.invalidateSize({ animate: false })
    })

    /* Also re-measure whenever the container is resized (e.g. panel open/close) */
    const ro = new ResizeObserver(() => {
      map.invalidateSize({ animate: false })
    })
    if (containerRef.current) ro.observe(containerRef.current)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      markersRef.current.forEach((m) => m.remove())
      officerMarkersRef.current.forEach((m) => m.remove())
      userMarkerRef.current?.remove()
      routeRef.current?.remove()
      heatRef.current?.remove()
      map.remove()
      mapRef.current = null
      tileRef.current = null
      labelsRef.current = null
      heatRef.current = null
      markersRef.current = []
      officerMarkersRef.current = []
      userMarkerRef.current = null
      routeRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ── switch tile layer when mode changes ── */
  useEffect(() => {
    const map = mapRef.current
    const tile = tileRef.current
    const lbl = labelsRef.current
    if (!map || !tile || !lbl) return

    const cfg = TILE_LAYERS[layerMode]
    tile.setUrl(cfg.url)

    // labels only make sense over satellite
    if (layerMode === 'satellite' && showLabels) {
      if (!map.hasLayer(lbl)) lbl.addTo(map)
    } else {
      if (map.hasLayer(lbl)) lbl.remove()
    }
  }, [layerMode, showLabels])

  /* ── pothole markers ── */
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    markersRef.current.forEach((m) => m.remove())
    markersRef.current = []

    for (const p of potholes) {
      const color = markerColor(p)
      const isSelected = p.id === selectedId
      const marker = L.marker([p.latitude, p.longitude], {
        icon: makePotholeIcon(color, isSelected),
        zIndexOffset: isSelected ? 1000 : 0,
      })

      const sev = p.severity.charAt(0) + p.severity.slice(1).toLowerCase()
      const status = p.status.replace(/_/g, ' ').toLowerCase()
      marker.bindPopup(
        `<div style="font-family:system-ui;min-width:160px;color:#fff;">
          <div style="font-weight:700;font-size:13px;margin-bottom:4px;">${p.incident_code}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;">
            <span style="background:${color}22;color:${color};border:1px solid ${color}55;border-radius:20px;padding:1px 8px;font-size:11px;font-weight:600;">${sev}</span>
            <span style="background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.7);border-radius:20px;padding:1px 8px;font-size:11px;">${status}</span>
          </div>
          ${p.address ? `<div style="font-size:11px;color:rgba(255,255,255,0.55);margin-bottom:4px;">📍 ${p.address}</div>` : ''}
          <div style="font-size:11px;color:rgba(255,255,255,0.45);">Depth: ${p.depth_cm != null ? p.depth_cm.toFixed(1) + ' cm' : 'unknown'}</div>
        </div>`,
        {
          className: 'rg-popup',
          maxWidth: 260,
        },
      )

      marker.on('click', () => onSelect?.(p))
      marker.addTo(map)
      markersRef.current.push(marker)
    }
  }, [potholes, selectedId, onSelect])

  /* ── officer markers ── */
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    officerMarkersRef.current.forEach((m) => m.remove())
    officerMarkersRef.current = []

    for (const o of officers) {
      if (o.latitude == null || o.longitude == null) continue
      const marker = L.marker([o.latitude, o.longitude], { icon: makeOfficerIcon() })
      marker.addTo(map)
      officerMarkersRef.current.push(marker)
    }
  }, [officers])

  /* ── user location ── */
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    userMarkerRef.current?.remove()
    userMarkerRef.current = null
    if (!userFix) return
    const marker = L.marker([userFix.latitude, userFix.longitude], {
      icon: makeUserIcon(),
      zIndexOffset: 2000,
    }).addTo(map)
    userMarkerRef.current = marker
  }, [userFix])

  /* ── heatmap ── */
  useEffect(() => {
    const map = mapRef.current
    const heat = heatRef.current
    if (!map || !heat) return

    if (heatmap && heatCells.length > 0) {
      if (!map.hasLayer(heat)) heat.addTo(map)
      heat.setCells(heatCells)
    } else {
      if (map.hasLayer(heat)) heat.remove()
    }
  }, [heatmap, heatCells])

  /* ── route ── */
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    routeRef.current?.remove()
    routeRef.current = null
    if (!route || route.length < 2) return
    const line = L.polyline(route.map(([lng, lat]) => [lat, lng] as L.LatLngExpression), {
      color: '#4cc9f0',
      weight: 4,
      dashArray: '10 6',
      opacity: 0.9,
    }).addTo(map)
    routeRef.current = line
  }, [route])

  /* ── recenter ── */
  const recenter = () => {
    if (!userFix || !mapRef.current) return
    mapRef.current.flyTo([userFix.latitude, userFix.longitude], 16, { duration: 0.8 })
  }

  /* ── zoom controls ── */
  const zoomIn  = () => mapRef.current?.zoomIn()
  const zoomOut = () => mapRef.current?.zoomOut()

  return (
    <div
      className={cn('relative overflow-hidden rounded-ios', className)}
      style={{ minHeight: 320, ...style }}
    >
      {/* Leaflet container — must have real pixel dimensions before L.map() runs */}
      <div ref={containerRef} style={{ height: '100%', minHeight: 320, width: '100%' }} />

      {/* ── layer switcher ── */}
      <div className="absolute left-3 top-3 z-[9999] flex gap-1.5">
        <button
          type="button"
          onClick={() => setLayerMode('satellite')}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-semibold backdrop-blur transition',
            layerMode === 'satellite'
              ? 'border-aurora-400/60 bg-aurora-400/20 text-aurora-200 shadow-lg'
              : 'border-white/15 bg-black/40 text-white/60 hover:text-white',
          )}
        >
          <Satellite className="h-3 w-3" />
          Satellite
        </button>
        <button
          type="button"
          onClick={() => setLayerMode('street')}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-semibold backdrop-blur transition',
            layerMode === 'street'
              ? 'border-aurora-400/60 bg-aurora-400/20 text-aurora-200 shadow-lg'
              : 'border-white/15 bg-black/40 text-white/60 hover:text-white',
          )}
        >
          <MapIcon className="h-3 w-3" />
          Street
        </button>
        {layerMode === 'satellite' ? (
          <button
            type="button"
            onClick={() => setShowLabels((v) => !v)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-semibold backdrop-blur transition',
              showLabels
                ? 'border-white/30 bg-white/15 text-white'
                : 'border-white/15 bg-black/40 text-white/50',
            )}
          >
            Labels
          </button>
        ) : null}
      </div>

      {/* ── zoom buttons ── */}
      <div className="absolute right-3 bottom-16 z-[9999] flex flex-col gap-1">
        <button
          type="button"
          onClick={zoomIn}
          aria-label="Zoom in"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/60 text-lg font-bold text-white backdrop-blur shadow-lg transition hover:bg-black/80"
        >
          +
        </button>
        <button
          type="button"
          onClick={zoomOut}
          aria-label="Zoom out"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/60 text-lg font-bold text-white backdrop-blur shadow-lg transition hover:bg-black/80"
        >
          −
        </button>
      </div>

      {/* ── recenter ── */}
      <button
        type="button"
        onClick={recenter}
        disabled={!userFix}
        aria-label="Recenter on my location"
        className="absolute right-3 bottom-3 z-[9999] inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/60 text-white backdrop-blur shadow-lg disabled:opacity-40 transition hover:bg-black/80"
      >
        <Locate className="h-4 w-4" aria-hidden />
      </button>

      {/* popup styles */}
      <style>{`
        .rg-popup .leaflet-popup-content-wrapper {
          background: rgba(13,15,26,0.92);
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 14px;
          backdrop-filter: blur(12px);
          box-shadow: 0 8px 32px rgba(0,0,0,0.6);
          padding: 0;
        }
        .rg-popup .leaflet-popup-content { margin: 12px 14px; }
        .rg-popup .leaflet-popup-tip-container { display:none; }
        .rg-popup .leaflet-popup-close-button {
          color: rgba(255,255,255,0.45) !important;
          font-size: 18px !important;
          top: 6px !important;
          right: 8px !important;
        }
      `}</style>
    </div>
  )
}

/* ─────────────────────────── Legend ─────────────────────────── */

export function MapLegend({
  showHeatmap,
  onToggleHeatmap,
  showOfficers = true,
}: {
  showHeatmap: boolean
  onToggleHeatmap: (value: boolean) => void
  showOfficers?: boolean
}) {
  const entries = [
    { label: 'Critical', color: SEVERITY_META.CRITICAL.hex },
    { label: 'High',     color: SEVERITY_META.HIGH.hex },
    { label: 'Medium',   color: SEVERITY_META.MEDIUM.hex },
    { label: 'Low',      color: SEVERITY_META.LOW.hex },
    { label: 'Resolved', color: RESOLVED_COLOR },
  ]

  return (
    <div className="glass-strong sheen flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl px-3 py-2">
      {entries.map((entry) => (
        <span key={entry.label} className="flex items-center gap-1.5 text-[10px] text-white/65">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: entry.color }}
            aria-hidden
          />
          {entry.label}
        </span>
      ))}
      {showOfficers ? (
        <span className="flex items-center gap-1.5 text-[10px] text-white/65">
          <span aria-hidden>🧑‍🔧</span> Officer
        </span>
      ) : null}
      <button
        type="button"
        onClick={() => onToggleHeatmap(!showHeatmap)}
        aria-pressed={showHeatmap}
        className={cn(
          'ml-auto inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition',
          showHeatmap
            ? 'border-aurora-400/50 bg-aurora-400/20 text-aurora-300'
            : 'border-white/15 text-white/55 hover:text-white',
        )}
      >
        <Layers className="h-3 w-3" aria-hidden />
        Heatmap
      </button>
    </div>
  )
}
