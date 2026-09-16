import { useEffect, useState, useRef } from 'react'
import { useStore } from '../store'

export type FaceMatch = {
  name: string
  confidence: number
  notes?: string
  at: number
}

// Global hook for bridge events
let onFaceMatchListener: ((match: FaceMatch) => void) | null = null
export function notifyFaceMatch(match: FaceMatch) {
  onFaceMatchListener?.(match)
}

export function FaceTracker() {
  const looking = useStore((s) => s.looking)
  const [activeMatch, setActiveMatch] = useState<FaceMatch | null>(null)
  const matchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    onFaceMatchListener = (match) => {
      setActiveMatch(match)
      if (matchTimer.current) clearTimeout(matchTimer.current)
      matchTimer.current = setTimeout(() => setActiveMatch(null), 8000)
    }
    return () => {
      onFaceMatchListener = null
      if (matchTimer.current) clearTimeout(matchTimer.current)
    }
  }, [])

  // Show when looking, or when a face match is active
  const show = Boolean(looking || activeMatch)
  if (!show) return null

  const subjectName = activeMatch?.name ? activeMatch.name.toUpperCase() : 'UNKNOWN SUBJECT'
  const confidenceStr = activeMatch?.confidence ? `${Math.round(activeMatch.confidence * 100)}%` : 'ANALYZING...'

  return (
    <div className="face-tracker-hud" aria-hidden="true">
      <div className={`face-bracket ${activeMatch ? 'confirmed' : 'scanning'}`}>
        <div className="bracket-corner tl" />
        <div className="bracket-corner tr" />
        <div className="bracket-corner bl" />
        <div className="bracket-corner br" />
        
        <div className="bracket-scanline" />

        <div className="bracket-info top">
          <span className="bracket-tag">
            {activeMatch ? '● BIOMETRIC MATCH DETECTED' : '⟳ BIOMETRIC SCAN IN PROGRESS'}
          </span>
          <span className="bracket-sub">{looking || 'TARGET LOCK'}</span>
        </div>

        <div className="bracket-info bottom">
          <div className="bracket-name">{subjectName}</div>
          <div className="bracket-meta">
            <span>CONF: {confidenceStr}</span>
            <span>STATUS: {activeMatch ? 'VERIFIED' : 'SCANNING'}</span>
          </div>
          {activeMatch?.notes && (
            <div className="bracket-notes">{activeMatch.notes}</div>
          )}
        </div>
      </div>
    </div>
  )
}
