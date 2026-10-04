import { useCallback, useEffect, useRef, useState } from 'react'
import { AppError } from '@/lib/errors'

/**
 * Camera control for the premium scan interface (spec section 12).
 *
 * Wraps getUserMedia with graceful degradation: if the environment cannot use
 * the rear camera, or torch is unsupported, the UI is told rather than being
 * handed a broken control.
 */

export type FacingMode = 'environment' | 'user'

export interface CaptureResult {
  dataUrl: string
  width: number
  height: number
}

export interface CameraState {
  videoRef: React.RefObject<HTMLVideoElement | null>
  ready: boolean
  starting: boolean
  error: AppError | null
  facing: FacingMode
  torchSupported: boolean
  torchOn: boolean
  hasStream: boolean
  start: () => Promise<void>
  stop: () => void
  switchCamera: () => Promise<void>
  toggleTorch: () => Promise<void>
  /**
   * Grab the current frame as a data URL. `maxEdge` (px) downscales the
   * capture, which the live-detection sampler uses to keep frames small.
   */
  capture: (quality?: number, maxEdge?: number) => CaptureResult | null
  /** Enumerate video input devices so the user can pick a specific camera. */
  listCameras: () => Promise<MediaDeviceInfo[]>
}

export function useCamera(): CameraState {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [ready, setReady] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<AppError | null>(null)
  const [facing, setFacing] = useState<FacingMode>('environment')
  const [torchSupported, setTorchSupported] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const [hasStream, setHasStream] = useState(false)

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setReady(false)
    setHasStream(false)
    setTorchOn(false)
  }, [])

  const start = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError(
        new AppError('CAMERA_UNAVAILABLE', {
          message: 'getUserMedia is unavailable (requires HTTPS or localhost).',
        }),
      )
      return
    }

    setStarting(true)
    setError(null)

    try {
      streamRef.current?.getTracks().forEach((track) => track.stop())

      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facing },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        })
      } catch (constraintErr) {
        // Fallback to basic video constraints if ideal resolution or facing mode failed
        console.warn('Initial camera constraints failed, falling back to basic video:', constraintErr)
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        })
      }

      streamRef.current = stream
      setHasStream(true)

      const track = stream.getVideoTracks()[0]
      const capabilities = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & {
        torch?: boolean
      }
      setTorchSupported(Boolean(capabilities.torch))

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.setAttribute('playsinline', 'true')
        await videoRef.current.play().catch(() => undefined)
      }
      setReady(true)
    } catch (caught) {
      const name = caught instanceof DOMException ? caught.name : ''
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setError(new AppError('PERMISSION_DENIED'))
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        setError(
          new AppError('CAMERA_UNAVAILABLE', {
            userMessage: 'No suitable camera was found on this device.',
            cause: caught,
          }),
        )
      } else {
        setError(new AppError('CAMERA_UNAVAILABLE', { cause: caught }))
      }
    } finally {
      setStarting(false)
    }
  }, [facing])

  // Ensure video element receives stream if mounted or updated after stream creation
  useEffect(() => {
    if (videoRef.current && streamRef.current && videoRef.current.srcObject !== streamRef.current) {
      videoRef.current.srcObject = streamRef.current
      videoRef.current.setAttribute('playsinline', 'true')
      videoRef.current.play().catch(() => undefined)
    }
  }, [hasStream, ready])

  const switchCamera = useCallback(async () => {
    const next: FacingMode = facing === 'environment' ? 'user' : 'environment'
    setFacing(next)
  }, [facing])

  // Restart the stream whenever the facing mode changes.
  useEffect(() => {
    if (!hasStream) return
    void start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facing])

  useEffect(() => stop, [stop])

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    try {
      // `torch` is a non-standard capability; cast through unknown so the
      // standard lib type does not reject it.
      await track.applyConstraints({
        advanced: [{ torch: !torchOn }],
      } as unknown as MediaTrackConstraints)
      setTorchOn((current) => !current)
    } catch {
      setTorchSupported(false)
    }
  }, [torchOn])

  const capture = useCallback<CameraState['capture']>((quality = 0.92, maxEdge) => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return null

    const scale = maxEdge ? Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight)) : 1
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(video.videoWidth * scale)
    canvas.height = Math.round(video.videoHeight * scale)
    const context = canvas.getContext('2d')
    if (!context) return null

    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    return {
      dataUrl: canvas.toDataURL('image/jpeg', quality),
      width: canvas.width,
      height: canvas.height,
    }
  }, [])

  const listCameras = useCallback(async (): Promise<MediaDeviceInfo[]> => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return []
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      return devices.filter((device) => device.kind === 'videoinput')
    } catch {
      return []
    }
  }, [])

  return {
    videoRef,
    ready,
    starting,
    error,
    facing,
    torchSupported,
    torchOn,
    hasStream,
    start,
    stop,
    switchCamera,
    toggleTorch,
    capture,
    listCameras,
  }
}

/** Read a user-selected file (gallery upload) as a data URL. */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(
        new AppError('UPLOAD_FAILED', {
          message: 'Not an image',
          userMessage: 'Please choose an image file.',
        }),
      )
      return
    }
    if (file.size > 15 * 1024 * 1024) {
      reject(
        new AppError('UPLOAD_FAILED', {
          message: 'File too large',
          userMessage: 'Images must be smaller than 15 MB.',
        }),
      )
      return
    }
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () =>
      reject(new AppError('UPLOAD_FAILED', { cause: reader.error, message: 'Read failed' }))
    reader.readAsDataURL(file)
  })
}

/**
 * Downscale a data URL before upload so mobile networks are not saturated by
 * 12-megapixel frames. Aspect ratio is preserved.
 */
export async function compressImage(dataUrl: string, maxEdge = 1600, quality = 0.85): Promise<string> {
  try {
    const image = await loadImage(dataUrl)
    const scale = Math.min(1, maxEdge / Math.max(image.width, image.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(image.width * scale)
    canvas.height = Math.round(image.height * scale)
    const context = canvas.getContext('2d')
    if (!context) return dataUrl
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', quality)
  } catch {
    return dataUrl
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Image failed to load'))
    image.src = src
  })
}
