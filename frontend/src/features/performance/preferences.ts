import { useSyncExternalStore } from 'react'

export const fpsPreferenceKey = 'genesis.show-fps.v1'
const changedEvent = 'genesis:show-fps'

export function readFpsEnabled(): boolean {
  try { return localStorage.getItem(fpsPreferenceKey) === 'true' }
  catch { return false }
}

export function saveFpsEnabled(enabled: boolean): boolean {
  try {
    localStorage.setItem(fpsPreferenceKey, String(enabled))
    window.dispatchEvent(new Event(changedEvent))
    return true
  } catch { return false }
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === fpsPreferenceKey || event.key === null) listener()
  }
  window.addEventListener(changedEvent, listener)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(changedEvent, listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function useFpsEnabled() {
  return useSyncExternalStore(subscribe, readFpsEnabled, () => false)
}
