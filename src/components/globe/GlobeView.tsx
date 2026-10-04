import { OrbitControls, Stars } from '@react-three/drei'
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { SEVERITY_META } from '@/lib/constants'
import { latLngToVector3 } from '@/lib/geo'
import { cn } from '@/lib/utils'
import type { Pothole } from '@/types'

/**
 * 3D world globe with real satellite Earth texture.
 *
 * Textures are loaded from the official Three.js GitHub repository — these
 * are always available and require no API key. Failures are caught gracefully
 * so the globe always renders (falling back to a dark procedural sphere).
 */

const GLOBE_RADIUS = 1
const RESOLVED_COLOR = '#8e8e93'

/* ─── Official Three.js example textures (GitHub raw, always available) ─── */
const THREEJS_RAW = 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets'
const TEX = {
  day:      `${THREEJS_RAW}/earth_atmos_2048.jpg`,
  specular: `${THREEJS_RAW}/earth_specular_2048.jpg`,
  normal:   `${THREEJS_RAW}/earth_normal_2048.jpg`,
  clouds:   `${THREEJS_RAW}/earth_clouds_1024.png`,
}

/* ─── Safe texture loader — never throws, returns null on failure ─── */
function useTexture(url: string): THREE.Texture | null {
  const [tex, setTex] = useState<THREE.Texture | null>(null)

  useEffect(() => {
    let active = true
    const loader = new THREE.TextureLoader()
    loader.setCrossOrigin('anonymous')
    loader.load(
      url,
      (loaded) => { if (active) setTex(loaded) },
      undefined,
      (err) => { console.warn('[globe] texture failed:', url, err) },
    )
    return () => { active = false }
  }, [url])

  return tex
}

/* ─────────────────────────── GlobeViewProps ─────────────────────────── */

export interface GlobeViewProps {
  potholes: Pothole[]
  selectedId?: string | null
  onSelect?: (pothole: Pothole) => void
  autoRotate?: boolean
  /** Legacy prop — kept for API compat but ignored. */
  textureUrl?: string
  className?: string
}

/* ─────────────────────────── GlobeView ─────────────────────────── */

export function GlobeView({
  potholes,
  selectedId,
  onSelect,
  autoRotate = true,
  className,
}: GlobeViewProps) {
  return (
    <div className={cn('relative', className)}>
      <Canvas
        camera={{ position: [0, 0.9, 2.7], fov: 42 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 0)
        }}
      >
        {/* No Suspense — all textures load asynchronously without throwing */}
        <ambientLight intensity={0.2} />
        <directionalLight position={[5, 3, 5]} intensity={1.8} color="#fff8f0" />
        <pointLight position={[-6, -2, -4]} intensity={28} color="#4cc9f0" distance={15} />

        <Stars radius={100} depth={50} count={3000} factor={3} fade speed={0.3} />

        <group rotation={[0, -0.5, 0]}>
          <Earth />
          <Clouds />
          <Atmosphere />
          {potholes.map((pothole) => (
            <Marker
              key={pothole.id}
              pothole={pothole}
              selected={pothole.id === selectedId}
              onSelect={onSelect}
            />
          ))}
        </group>

        <OrbitControls
          enablePan={false}
          enableZoom
          minDistance={1.4}
          maxDistance={5.5}
          autoRotate={autoRotate}
          autoRotateSpeed={0.5}
          enableDamping
          dampingFactor={0.07}
        />
      </Canvas>
    </div>
  )
}

/* ─────────────────────────── Earth sphere ─────────────────────────── */

function Earth() {
  const dayMap      = useTexture(TEX.day)
  const specularMap = useTexture(TEX.specular)
  const normalMap   = useTexture(TEX.normal)

  return (
    <mesh>
      <sphereGeometry args={[GLOBE_RADIUS, 96, 96]} />
      <meshPhongMaterial
        map={dayMap ?? undefined}
        specularMap={specularMap ?? undefined}
        specular={new THREE.Color(0x334455)}
        shininess={20}
        normalMap={normalMap ?? undefined}
        normalScale={new THREE.Vector2(5, 5)}
        /* Fallback color when textures are still downloading */
        color={dayMap ? '#ffffff' : '#0b1b30'}
        emissive={new THREE.Color(0x06121f)}
        emissiveIntensity={dayMap ? 0 : 0.9}
      />
    </mesh>
  )
}

/* ─────────────────────────── Clouds ─────────────────────────── */

function Clouds() {
  const cloudMap = useTexture(TEX.clouds)
  const meshRef  = useRef<THREE.Mesh>(null)

  useFrame((_, delta) => {
    if (meshRef.current) {
      meshRef.current.rotation.y += delta * 0.04
    }
  })

  if (!cloudMap) return null   // hide until loaded

  return (
    <mesh ref={meshRef} scale={1.007}>
      <sphereGeometry args={[GLOBE_RADIUS, 64, 64]} />
      <meshPhongMaterial
        map={cloudMap}
        transparent
        opacity={0.38}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  )
}

/* ─────────────────────────── Atmosphere glow ─────────────────────────── */

const ATM_VERT = /* glsl */`
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const ATM_FRAG = /* glsl */`
  varying vec3 vNormal;
  void main() {
    float intensity = pow(0.72 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.0);
    gl_FragColor = vec4(0.28, 0.74, 0.96, 1.0) * intensity;
  }
`

function Atmosphere() {
  return (
    <mesh scale={1.18}>
      <sphereGeometry args={[GLOBE_RADIUS, 48, 48]} />
      <shaderMaterial
        vertexShader={ATM_VERT}
        fragmentShader={ATM_FRAG}
        side={THREE.BackSide}
        blending={THREE.AdditiveBlending}
        transparent
        depthWrite={false}
      />
    </mesh>
  )
}

/* ─────────────────────────── Pothole marker ─────────────────────────── */

function Marker({
  pothole,
  selected,
  onSelect,
}: {
  pothole: Pothole
  selected: boolean
  onSelect?: (pothole: Pothole) => void
}) {
  const dotRef  = useRef<THREE.Mesh>(null)
  const ringRef = useRef<THREE.Mesh>(null)

  const color = useMemo(() => {
    if (pothole.status === 'RESOLVED') return RESOLVED_COLOR
    return SEVERITY_META[pothole.severity]?.hex ?? '#4cc9f0'
  }, [pothole.status, pothole.severity])

  const position = useMemo(
    () => latLngToVector3(pothole.latitude, pothole.longitude, GLOBE_RADIUS * 1.022),
    [pothole.latitude, pothole.longitude],
  )

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime()
    if (dotRef.current) {
      dotRef.current.scale.setScalar(selected ? 1.6 + Math.sin(t * 4.5) * 0.28 : 1)
    }
    if (ringRef.current) {
      const phase = (t * 0.65) % 1
      ringRef.current.scale.setScalar(1 + phase * 2.2)
      const mat = ringRef.current.material as THREE.MeshBasicMaterial
      mat.opacity = Math.max(0, 0.7 - phase * 0.7)
    }
  })

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    onSelect?.(pothole)
  }

  return (
    <group position={position}>
      {/* Glowing dot */}
      <mesh
        ref={dotRef}
        onClick={handleClick}
        onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer' }}
        onPointerOut={() => { document.body.style.cursor = 'auto' }}
      >
        <sphereGeometry args={[selected ? 0.024 : 0.016, 16, 16]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={selected ? 2.2 : 1.5}
          toneMapped={false}
        />
      </mesh>

      {/* Expanding pulse ring */}
      <mesh ref={ringRef} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.021, 0.03, 22]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.65}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
    </group>
  )
}

/* ─────────────────────────── Legend ─────────────────────────── */

export function GlobeLegend({ className }: { className?: string }) {
  const entries = [
    { label: 'Critical', color: SEVERITY_META.CRITICAL.hex },
    { label: 'High',     color: SEVERITY_META.HIGH.hex },
    { label: 'Medium',   color: SEVERITY_META.MEDIUM.hex },
    { label: 'Low',      color: SEVERITY_META.LOW.hex },
    { label: 'Resolved', color: RESOLVED_COLOR },
  ]
  return (
    <div
      className={cn(
        'glass-strong sheen flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl px-3 py-2',
        className,
      )}
    >
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
    </div>
  )
}
