import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  VOICE_PROFILES,
  getActiveProfile,
  setActiveProfile,
  testVoice,
  type VoiceProfile,
  type VoiceProfileId,
} from '../lib/tts'
import { useStore } from '../store'

interface VoiceModalProps {
  isOpen: boolean
  onClose: () => void
  onVoiceChanged?: (profile: VoiceProfile) => void
}

export function VoiceModal({ isOpen, onClose, onVoiceChanged }: VoiceModalProps) {
  const [active, setActive] = useState<VoiceProfile>(getActiveProfile())
  const [testingId, setTestingId] = useState<VoiceProfileId | null>(null)
  const setVoice = useStore((s) => s.setVoice)

  const handleSelect = (profile: VoiceProfile) => {
    const updated = setActiveProfile(profile.id)
    setActive(updated)
    setVoice(updated.name)
    onVoiceChanged?.(updated)
  }

  const handleAudition = async (e: React.MouseEvent, profileId: VoiceProfileId) => {
    e.stopPropagation()
    setTestingId(profileId)
    try {
      await testVoice(profileId)
    } finally {
      setTimeout(() => setTestingId((cur) => (cur === profileId ? null : cur)), 2500)
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="voice-modal-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="voice-modal-card"
            initial={{ scale: 0.92, opacity: 0, y: 16 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.92, opacity: 0, y: 16 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="voice-modal-header">
              <div className="voice-modal-title-box">
                <span className="voice-modal-badge">AUDIO PROTOCOLS</span>
                <h2 className="voice-modal-title">SYNTHESIS MATRIX</h2>
                <p className="voice-modal-desc">
                  Select vocal profile for JARVIS responses and real-time speech
                </p>
              </div>
              <button
                type="button"
                className="voice-modal-close"
                onClick={onClose}
                title="Close (Esc)"
              >
                ✕
              </button>
            </div>

            <div className="voice-profile-grid">
              {VOICE_PROFILES.map((p) => {
                const isCurrent = active.id === p.id
                const isTesting = testingId === p.id

                return (
                  <div
                    key={p.id}
                    className={`voice-profile-card ${isCurrent ? 'selected' : ''}`}
                    onClick={() => handleSelect(p)}
                  >
                    <div className="voice-card-top">
                      <span className="voice-lang-tag">
                        {p.lang.startsWith('ta') ? 'TAMIL · தமிழ்' : 'ENGLISH'}
                      </span>
                      {isCurrent && <span className="voice-active-pill">● ACTIVE</span>}
                    </div>

                    <div className="voice-card-main">
                      <div className="voice-name">{p.label}</div>
                      <div className="voice-sublabel">{p.sublabel}</div>
                    </div>

                    <div className="voice-card-specs">
                      <span className="spec-tag">GENDER: {p.gender.toUpperCase()}</span>
                      <span className="spec-tag">PITCH: {p.pitch.toFixed(2)}</span>
                      <span className="spec-tag">PACE: {p.rate.toFixed(2)}</span>
                    </div>

                    <div className="voice-card-actions">
                      <button
                        type="button"
                        className={`voice-test-btn ${isTesting ? 'testing' : ''}`}
                        onClick={(e) => handleAudition(e, p.id)}
                        title="Audition sample phrase"
                      >
                        {isTesting ? (
                          <>
                            <span className="audio-pulse" />
                            <span>PLAYING SAMPLE...</span>
                          </>
                        ) : (
                          <>
                            <span>▶ AUDITION</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        className={`voice-select-btn ${isCurrent ? 'current' : ''}`}
                        onClick={() => handleSelect(p)}
                      >
                        {isCurrent ? 'SELECTED' : 'ACTIVATE'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="voice-modal-footer">
              <span className="voice-modal-hint">
                Press <kbd>V</kbd> anytime to cycle voice profiles immediately
              </span>
              <button type="button" className="voice-modal-done-btn" onClick={onClose}>
                CONFIRM PROTOCOL
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
