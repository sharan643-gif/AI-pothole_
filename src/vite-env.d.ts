/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  /** MapLibre style URL or Mapbox public token for the base map. */
  readonly VITE_MAP_STYLE_URL?: string
  readonly VITE_MAPBOX_TOKEN?: string
  /** Optional equirectangular earth texture for the 3D globe. */
  readonly VITE_GLOBE_TEXTURE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
