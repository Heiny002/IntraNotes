import { useRef, useCallback } from 'react'

/**
 * Returns a debounced save function.
 * @param {Function} saveFn - async function to call
 * @param {number} delay - debounce delay in ms
 */
export function useAutoSave(saveFn, delay = 1500) {
  const timer = useRef(null)

  const schedule = useCallback((...args) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => saveFn(...args), delay)
  }, [saveFn, delay])

  const flush = useCallback((...args) => {
    if (timer.current) clearTimeout(timer.current)
    return saveFn(...args)
  }, [saveFn])

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  return { schedule, flush, cancel }
}
