import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

/**
 * jsdom does not implement the browser APIs the UI relies on. Polyfill the
 * minimum so component tests exercise real render paths.
 */

if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  })
}

if (!('ResizeObserver' in window)) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(window, 'ResizeObserver', {
    writable: true,
    value: ResizeObserverStub,
  })
}

if (!('IntersectionObserver' in window)) {
  class IntersectionObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return []
    }
  }
  Object.defineProperty(window, 'IntersectionObserver', {
    writable: true,
    value: IntersectionObserverStub,
  })
}

if (!navigator.geolocation) {
  Object.defineProperty(navigator, 'geolocation', {
    writable: true,
    value: {
      getCurrentPosition: vi.fn(),
      watchPosition: vi.fn(() => 1),
      clearWatch: vi.fn(),
    },
  })
}

afterEach(() => {
  cleanup()
})
