import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useStore } from '../store'

/**
 * Holographic Assembly Boot Sequence
 *
 * Implements the cinematic particle vortex and assembly telemetry from the
 * user reference photos:
 * - Transparent full-frame HUD allowing the 3D particle vortex to shine through.
 * - Right-aligned digital readout: "ASSEMBLING  xx%" with diagnostic metrics.
 * - Dynamic stage progression linked to GPU particle convergence (uAssemble).
 * - High-tech cybernetic crosshairs, scanning lines, and system status stream.
 */

const BOOT_DURATION_MS = 8600

const TELEMETRY_STAGES = [
  { at: 0.05, line1: 'SINGULARITY DETECTED', line2: 'EMITTING STREAMLINE VORTEX' },
  { at: 0.22, line1: 'MAGNETIC CONVERGENCE', line2: 'ATTRACTOR VECTORS ALIGNED' },
  { at: 0.45, line1: 'SHOULDER TOPOGRAPHY', line2: 'STRUCTURAL LATTICE STABILIZING' },
  { at: 0.65, line1: 'NEURAL CHANNELS CHARGING', line2: 'CERVICAL SYNAPSES ACTIVE' },
  { at: 0.82, line1: 'CONSCIOUSNESS CORE IGNITED', line2: 'ACOUSTIC WAVEFORM HARMONIZING' },
  { at: 0.96, line1: 'ALL SYSTEMS NOMINAL', line2: 'J.A.R.V.I.S. READY FOR PROTOCOL' },
]

export function Boot() {
  const phase = useStore((s) => s.phase)
  const setAssembleProgress = useStore((s) => s.setAssembleProgress)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (phase !== 'boot') {
      setElapsed(0)
      setAssembleProgress(phase === 'offline' ? 0 : 1)
      return
    }

    const start = Date.now()
    setElapsed(0)
    setAssembleProgress(0)

    const interval = setInterval(() => {
      const now = Date.now() - start
      setElapsed(now)
      const progress = Math.min(1, now / BOOT_DURATION_MS)
      setAssembleProgress(progress)
    }, 30)

    return () => clearInterval(interval)
  }, [phase, setAssembleProgress])

  if (phase !== 'boot') return null

  const progress = Math.min(1, elapsed / BOOT_DURATION_MS)
  const pct = Math.floor(progress * 100)

  // Current diagnostic telemetry
  const stageInfo =
    [...TELEMETRY_STAGES].reverse().find((s) => progress >= s.at) ??
    TELEMETRY_STAGES[0]

  return (
    <AnimatePresence>
      <motion.div
        className="boot-holo"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, filter: 'blur(8px)' }}
        transition={{ duration: 0.6 }}
      >
        {/* Subtle holographic corner frames */}
        <div className="holo-corner holo-corner-tl" />
        <div className="holo-corner holo-corner-tr" />
        <div className="holo-corner holo-corner-bl" />
        <div className="holo-corner holo-corner-br" />

        {/* Top subtle identity mark */}
        <div className="boot-holo-top">
          <span className="boot-holo-tag">SYSTEM INITIALISATION</span>
          <span className="boot-holo-sub">CORE // QUANTUM NEURAL MATRIX</span>
        </div>

        {/* Right-aligned sci-fi telemetry display matching user photo */}
        <motion.div
          className="boot-telemetry-panel"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
        >
          {/* Main "ASSEMBLING xx%" title */}
          <div className="telemetry-header">
            <span className="telemetry-label">
              ASSEMBLING{' '}
              <span className="telemetry-pct">
                {pct.toString().padStart(2, '0')}%
              </span>
            </span>
            <span className="telemetry-pulse-dot" />
          </div>

          {/* Micro segmented gauge bar */}
          <div className="telemetry-bar">
            {Array.from({ length: 28 }, (_, i) => {
              const active = i / 28 <= progress
              return (
                <span
                  key={i}
                  className={`telemetry-cell ${active ? 'active' : ''}`}
                />
              )
            })}
          </div>

          {/* Real-time system log telemetry */}
          <div className="telemetry-readout">
            <div className="telemetry-row">
              <span className="tel-k">STATUS</span>
              <span className="tel-v">{stageInfo.line1}</span>
            </div>
            <div className="telemetry-row">
              <span className="tel-k">MATRIX</span>
              <span className="tel-v">{stageInfo.line2}</span>
            </div>
            <div className="telemetry-row">
              <span className="tel-k">FREQ</span>
              <span className="tel-v">
                {(104.2 + (progress * 42.6)).toFixed(2)} GHz
              </span>
            </div>
            <div className="telemetry-row">
              <span className="tel-k">SYNAPSE</span>
              <span className="tel-v">
                {pct >= 90 ? 'LOCKED (100%)' : `${(pct * 1.1).toFixed(0)}% STABILIZED`}
              </span>
            </div>
          </div>

          {/* Decorative cybernetic grid points */}
          <div className="telemetry-decor">
            <div className="decor-crosshair" />
            <span className="decor-grid-dots">············</span>
            <span className="decor-id">MK-VII.084</span>
          </div>
        </motion.div>

        {/* Bottom subtle progress hint */}
        <div className="boot-holo-bottom">
          <span className="boot-sync-indicator">
            CALIBRATING SPATIAL HOLOGRAPHIC LATTICE
          </span>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
