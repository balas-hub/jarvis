import { useState, useEffect } from 'react'
import { useStore } from '../store'
import { hands } from '../lib/hands'

const PALETTE = [
  { name: 'CYAN', color: '#00ffff' },
  { name: 'AMBER', color: '#ffaa00' },
  { name: 'VIOLET', color: '#cc00ff' },
  { name: 'EMERALD', color: '#00ff66' },
  { name: 'CRIMSON', color: '#ff2244' },
]

export function PlaygroundHud() {
  const playground = useStore((s) => s.playground)
  const playgroundColor = useStore((s) => s.playgroundColor)
  const setPlayground = useStore((s) => s.setPlayground)
  const setPlaygroundColor = useStore((s) => s.setPlaygroundColor)
  const [gestureText, setGestureText] = useState('STANDBY')

  useEffect(() => {
    if (!playground) return
    const timer = setInterval(() => {
      if (hands.length === 0) {
        setGestureText('NO HAND DETECTED — RAISE HAND TO CAMERA')
        return
      }
      const h = hands[0]
      const f = h.fingers
      if (f.index && !f.middle && !f.ring && !f.pinky) {
        setGestureText('☝️ DRAWING — INDEX FINGER POINTED')
      } else if (f.index && f.middle && !f.ring && !f.pinky) {
        setGestureText('✌️ ERASING — TWO FINGERS POINTED')
      } else if (h.pinched) {
        setGestureText('🤏 DRAGGING — PINCH THUMB & INDEX')
      } else if (f.thumb && f.index && f.middle && f.ring && f.pinky) {
        setGestureText('🖐️ 3D ROTATION — OPEN PALM ROTATING')
      } else {
        setGestureText('STANDBY — POINT INDEX TO DRAW, 2 FINGERS TO ERASE')
      }
    }, 100)
    return () => clearInterval(timer)
  }, [playground])

  if (!playground) return null

  const handleClear = () => {
    window.dispatchEvent(new CustomEvent('jarvis-playground-clear'))
  }

  const handleExit = () => {
    setPlayground(false)
  }

  return (
    <div className="playground-hud" aria-label="3D Holographic Playground Controls">
      {/* Top Banner */}
      <div className="playground-banner">
        <div className="playground-title-row">
          <span className="playground-pulse" />
          <span className="playground-tag">HOLOGRAPHIC 3D PLAYGROUND</span>
          <span className="playground-badge">GESTURE ENGINE V2</span>
        </div>
        <div className="playground-status-line">{gestureText}</div>
      </div>

      {/* Floating Toolbar */}
      <div className="playground-dock">
        <div className="playground-colors">
          {PALETTE.map((p) => (
            <button
              key={p.color}
              type="button"
              className={`playground-color-btn ${playgroundColor === p.color ? 'active' : ''}`}
              style={{ backgroundColor: p.color, boxShadow: playgroundColor === p.color ? `0 0 12px ${p.color}` : 'none' }}
              onClick={() => setPlaygroundColor(p.color)}
              title={p.name}
            />
          ))}
        </div>

        <div className="playground-actions">
          <button
            type="button"
            className="playground-btn clear"
            onClick={handleClear}
            title="Erase all drawn shapes"
          >
            CLEAR CANVAS
          </button>
          <button
            type="button"
            className="playground-btn exit"
            onClick={handleExit}
            title="Exit Playground Mode"
          >
            EXIT PLAYGROUND
          </button>
        </div>
      </div>
    </div>
  )
}
