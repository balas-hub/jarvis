import { useState, useEffect } from 'react'
import { useStore } from '../store'
import { hands, THUMB_TIP, INDEX_TIP, MIDDLE_TIP } from '../lib/hands'

const PALETTE = [
  { name: 'CYAN', color: '#00ffff' },
  { name: 'AMBER', color: '#ffaa00' },
  { name: 'VIOLET', color: '#cc00ff' },
  { name: 'EMERALD', color: '#00ff66' },
  { name: 'CRIMSON', color: '#ff2244' },
]

const SHAPES = [
  { id: 'cube', label: 'CUBE', icon: '◻️' },
  { id: 'sphere', label: 'SPHERE', icon: '⚪' },
  { id: 'pyramid', label: 'PYRAMID', icon: '▲' },
  { id: 'torus', label: 'TORUS', icon: '⭕' },
  { id: 'reactor', label: 'REACTOR', icon: '⚛️' },
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
      const pts = h.points

      if (!pts || pts.length < 21) return

      // Physical touch contact detection (thumb + index)
      const pThumb = pts[THUMB_TIP]
      const pIndex = pts[INDEX_TIP]
      const pMiddle = pts[MIDDLE_TIP]

      const touchDist = Math.hypot(pThumb.x - pIndex.x, pThumb.y - pIndex.y)
      const isPhysicalTouch = touchDist < Math.max(26, h.span * 0.22)

      // Thumb + middle finger pinch for clicking options
      const thumbMiddleDist = Math.hypot(pThumb.x - pMiddle.x, pThumb.y - pMiddle.y)
      const isThumbMiddlePinch = thumbMiddleDist < Math.max(26, h.span * 0.22)

      const isFist = !f.index && !f.middle && !f.ring && !f.pinky
      const isPointer = f.index && !f.middle && !f.ring && !f.pinky && !isPhysicalTouch
      const isDraw = f.index && f.middle && !f.ring && !f.pinky && !isPhysicalTouch && !isThumbMiddlePinch
      const isErase = f.index && f.middle && f.ring && !f.pinky
      const isPalm = f.thumb && f.index && f.middle && f.ring && f.pinky

      if (isThumbMiddlePinch) {
        setGestureText('👌 SELECTING OPTION — PINCH THUMB & MIDDLE TO CLICK')
      } else if (isPhysicalTouch) {
        setGestureText('✨ DRAGGING — TOUCH THUMB & INDEX TO MOVE SHAPES')
      } else if (isFist) {
        setGestureText('✊ 3D REVOLVE & ROTATE — MOVE CLOSED FIST IN 3D SPACE')
      } else if (isPointer) {
        setGestureText('☝️ POINTER — AIM & TARGET IN 3D SPACE (NO DRAW)')
      } else if (isDraw) {
        setGestureText('✌️ DRAWING — 2 FINGERS POINTED')
      } else if (isErase) {
        setGestureText('🤟 ERASING — 3 FINGERS POINTED')
      } else if (isPalm) {
        setGestureText('🖐️ OPEN PALM (IDLE)')
      } else {
        setGestureText('STANDBY — ☝️ POINT · ✌️ DRAW · 🤟 ERASE · ✊ 3D REVOLVE · 👌 PINCH THUMB+MIDDLE TO CLICK')
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

  const handleSpawnShape = (type: string) => {
    window.dispatchEvent(
      new CustomEvent('jarvis-playground-spawn-shape', {
        detail: { type, color: playgroundColor },
      })
    )
  }

  return (
    <div className="playground-hud" aria-label="3D Holographic Playground Controls">
      {/* Top Banner */}
      <div className="playground-banner">
        <div className="playground-title-row">
          <span className="playground-pulse" />
          <span className="playground-tag">HOLOGRAPHIC 3D PLAYGROUND</span>
          <span className="playground-badge">SPATIAL GESTURE V2</span>
        </div>
        <div className="playground-status-line">{gestureText}</div>
      </div>

      {/* Floating Control Dock */}
      <div className="playground-dock">
        {/* Prebuilt Shapes Toolbar */}
        <div className="playground-shapes-bar">
          <span className="playground-section-label">SHAPES:</span>
          {SHAPES.map((s) => (
            <button
              key={s.id}
              type="button"
              className="playground-shape-btn"
              onClick={() => handleSpawnShape(s.id)}
              title={`Spawn 3D ${s.label}`}
            >
              <span className="playground-shape-icon">{s.icon}</span>
              <span>{s.label}</span>
            </button>
          ))}
        </div>

        <div className="playground-divider" />

        {/* Color Palette */}
        <div className="playground-colors">
          <span className="playground-section-label">COLOR:</span>
          {PALETTE.map((p) => (
            <button
              key={p.color}
              type="button"
              className={`playground-color-btn ${playgroundColor === p.color ? 'active' : ''}`}
              style={{
                backgroundColor: p.color,
                boxShadow: playgroundColor === p.color ? `0 0 12px ${p.color}` : 'none',
              }}
              onClick={() => setPlaygroundColor(p.color)}
              title={p.name}
            />
          ))}
        </div>

        <div className="playground-divider" />

        {/* Canvas Actions */}
        <div className="playground-actions">
          <button
            type="button"
            className="playground-btn clear"
            onClick={handleClear}
            title="Erase all drawn and spawned shapes"
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
