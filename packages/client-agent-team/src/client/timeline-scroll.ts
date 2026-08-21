import { useCallback, useEffect, useRef } from 'react'

const BOTTOM_MARGIN_PX = 48
const BOUNDARY_OFFSET_PX = 12

export interface TimelineScroll {
  readonly ref: React.RefObject<HTMLElement>
  onScroll: () => void
  /** Jump to the unread-boundary marker on the next content commit. */
  jumpToBoundary: () => void
  /** Jump to the latest fact on the next content commit. */
  jumpToLatest: () => void
}

/**
 * Chat-timeline scroll policy shared by the Channel and Thread pages: follow
 * new facts only while the reader stays pinned to the bottom, keep prepended
 * history visually stable, and honor explicit jump requests exactly once per
 * content commit. The content key must change whenever rendered facts change.
 */
export function useTimelineScroll(contentKey: string): TimelineScroll {
  const ref = useRef<HTMLElement>(null)
  const pinnedRef = useRef(true)
  const heightRef = useRef(0)
  const jumpRef = useRef<'boundary' | 'latest'>()

  const onScroll = useCallback(() => {
    const element = ref.current
    if (element === null) return
    pinnedRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < BOTTOM_MARGIN_PX
  }, [])

  const jumpToBoundary = useCallback(() => {
    jumpRef.current = 'boundary'
    pinnedRef.current = false
  }, [])

  const jumpToLatest = useCallback(() => {
    jumpRef.current = 'latest'
    pinnedRef.current = true
  }, [])

  useEffect(() => {
    const element = ref.current
    if (element === null) return
    const previousHeight = heightRef.current
    heightRef.current = element.scrollHeight
    const jump = jumpRef.current
    jumpRef.current = undefined
    if (jump === 'boundary') {
      const marker = element.querySelector<HTMLElement>('[data-thread-boundary]')
      if (marker !== null) {
        element.scrollTop += marker.getBoundingClientRect().top - element.getBoundingClientRect().top - BOUNDARY_OFFSET_PX
        return
      }
    }
    if (jump === 'latest' || pinnedRef.current) {
      element.scrollTop = element.scrollHeight
      return
    }
    // Prepended older history must not shift the content the reader is on.
    if (previousHeight > 0 && element.scrollHeight > previousHeight) {
      element.scrollTop += element.scrollHeight - previousHeight
    }
  }, [contentKey])

  return { ref, onScroll, jumpToBoundary, jumpToLatest }
}
