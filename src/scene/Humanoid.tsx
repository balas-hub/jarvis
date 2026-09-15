import { useRef, useMemo, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { Drive } from './Scene'
import { useStore } from '../store'
import { hands } from '../lib/hands'

/**
 * Total particle count for the supernatural humanoid bust.
 * 22,000 points renders at solid 60-120fps with additive blending.
 */
const PARTICLE_COUNT = 22000

// Particle types
const TYPE_CYAN_CONTOUR = 0.0
const TYPE_GOLD_TENDRIL = 1.0
const TYPE_AMBER_CORE   = 2.0
const TYPE_CHEST_ARC    = 3.0
const TYPE_AURA_MIST    = 4.0

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uAssemble;       // 0.0 (spiral vortex) -> 1.0 (fully locked humanoid)
  uniform float uAudioLevel;      // 0.0 .. 1.0 smoothed loudness
  uniform float uVoiceWave;       // 0.0 .. 1.0 speech modulation ripples
  uniform float uHeadYaw;         // Parallax head yaw
  uniform float uHeadPitch;       // Parallax head pitch
  uniform float uIntensity;
  uniform vec3  uAccentColor;

  attribute vec3  aOrigin;        // Swirling spiral vortex origin (Image 5)
  attribute float aOrder;         // 0.0 (chest core) -> 1.0 (head/amber)
  attribute float aType;          // Particle classification
  attribute float aPhase;         // Random seed
  attribute float aSize;          // Base particle size
  attribute vec3  aColor;         // Authored base color

  varying vec3  vColor;
  varying float vAlpha;
  varying float vType;

  // Rotation helpers
  vec3 rotateY(vec3 p, float a) {
    float c = cos(a), s = sin(a);
    return vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
  }

  vec3 rotateX(vec3 p, float a) {
    float c = cos(a), s = sin(a);
    return vec3(p.x, p.y * c - p.z * s, p.y * s + p.z * c);
  }

  void main() {
    vType = aType;
    float t = uTime;

    // --- 1. Compute Assembly Interpolation Progress ---
    // Each particle has an individual assembly window around aOrder.
    // Transition spans a width of ~0.35 in uAssemble space.
    float startT = max(0.0, aOrder * 0.75);
    float endT = min(1.0, startT + 0.32);
    float progress = smoothstep(startT, endT, uAssemble);

    // Dynamic spiral motion when in vortex state
    vec3 vortex = aOrigin;
    // Spiral particles rotate around Y axis while assembling
    float vortexAngle = t * (0.8 + aOrder * 1.2) + aPhase * 6.28318;
    float vx = vortex.x * cos(vortexAngle) - vortex.z * sin(vortexAngle);
    float vz = vortex.x * sin(vortexAngle) + vortex.z * cos(vortexAngle);
    vortex.x = vx;
    vortex.z = vz;
    vortex.y += sin(t * 2.0 + aPhase * 10.0) * 0.05;

    // Resting anatomical body target position
    vec3 body = position;

    // Subtle natural breathing motion (chest rise, slight sway)
    float breathe = sin(t * 1.1) * 0.02;
    if (body.y < 0.5) {
      body.y += breathe * 0.8;
      body.z += breathe * 0.5;
    } else {
      body.y += breathe * 0.4;
    }

    // --- 2. Voice & Audio Reactivity ---
    // If amber mind/speech core (type 2) or face contours (y > 0.85):
    if (aType == 2.0) {
      // Amber core expands and vibrates when JARVIS speaks
      float voicePulse = uVoiceWave * (0.15 + sin(t * 25.0 + aPhase * 20.0) * 0.08);
      body *= (1.0 + voicePulse);
    } else if (aType == 0.0 && body.y > 0.85) {
      // Horizontal contour scanline ripples across the face
      float wave = sin(body.y * 32.0 - t * 18.0) * uVoiceWave * 0.035;
      body.x += wave * cos(aPhase * 6.28);
      body.z += wave * sin(aPhase * 6.28);
    }

    // Chest Arc Node (type 3): pulses with audio loudness
    if (aType == 3.0) {
      body += vec3(
        sin(t * 15.0 + aPhase * 30.0) * 0.015,
        cos(t * 15.0 + aPhase * 30.0) * 0.015,
        0.0
      ) * (1.0 + uAudioLevel * 0.8);
    }

    // Golden tendrils (type 1): electric data ripples ascending up throat
    if (aType == 1.0) {
      float ripple = sin(body.y * 22.0 - t * 12.0) * 0.015;
      body.x += ripple;
    }

    // Outer shoulder particle mist dispersal (type 4): gentle drift
    if (aType == 4.0) {
      body.x += sin(t * 1.2 + aPhase * 15.0) * 0.04;
      body.y += cos(t * 1.5 + aPhase * 15.0) * 0.04;
      body.z += sin(t * 0.9 + aPhase * 15.0) * 0.04;
    }

    // --- 3. Parallax Head Tracking (Head & Neck Look-At) ---
    // Points at or above neck (y > 0.3) swivel smoothly
    if (body.y > 0.25) {
      float swivelWeight = smoothstep(0.25, 0.9, body.y);
      vec3 pivot = vec3(0.0, 0.45, 0.0);
      vec3 rel = body - pivot;
      rel = rotateY(rel, uHeadYaw * swivelWeight);
      rel = rotateX(rel, uHeadPitch * swivelWeight);
      body = pivot + rel;
    }

    // --- 4. Hermite Interpolation between Vortex & Body ---
    // Curved gravitational pull into locked position
    vec3 p = mix(vortex, body, progress);

    // During assembly arrival, add slight inward magnetic spiral snap
    if (progress > 0.01 && progress < 0.99) {
      float snapAngle = (1.0 - progress) * 8.0;
      float snapRadius = (1.0 - progress) * 0.25;
      p.x += cos(snapAngle + aPhase * 6.28) * snapRadius;
      p.z += sin(snapAngle + aPhase * 6.28) * snapRadius;
    }

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;

    // --- 5. Particle Coloring & Dynamic Brightness ---
    vec3 col = aColor;

    // Accent tinting
    if (aType == 0.0) {
      // Body contours: Cyan with subtle accent blending
      col = mix(aColor, uAccentColor, 0.25);
    } else if (aType == 1.0) {
      // Golden neural tendril: electric gold, brightening on speech
      col = mix(aColor, vec3(1.0, 0.9, 0.5), uVoiceWave * 0.6);
    } else if (aType == 2.0) {
      // Amber mind/speech core: flares bright golden-white on voice
      col = mix(aColor, vec3(1.0, 0.95, 0.7), uVoiceWave * 0.75);
    } else if (aType == 3.0) {
      // Chest arc singularity: piercing white-cyan with audio flare
      col = mix(vec3(0.65, 0.92, 1.0), vec3(1.0, 1.0, 1.0), uAudioLevel * 0.7);
    }

    vColor = col;

    // Alpha modulation based on depth and assembly progress
    float depthFade = smoothstep(-14.0, -2.0, mv.z);
    float assembleFade = smoothstep(0.0, 0.15, progress + (1.0 - aOrder) * 0.25);
    
    // Ambient breathing flicker
    float flicker = 0.88 + 0.12 * sin(t * 3.0 + aPhase * 20.0);
    
    vAlpha = depthFade * assembleFade * flicker * uIntensity;
    if (aType == 3.0) vAlpha *= 1.4; // Boost chest core
    if (aType == 2.0) vAlpha *= (1.0 + uVoiceWave * 0.5);

    // Point size perspective scaling
    float pSize = aSize * (14.0 / -mv.z);
    if (aType == 3.0) pSize *= (1.3 + uAudioLevel * 0.5);
    if (aType == 2.0) pSize *= (1.2 + uVoiceWave * 0.4);
    gl_PointSize = max(1.2, pSize);
  }
`

const fragmentShader = /* glsl */ `
  varying vec3  vColor;
  varying float vAlpha;
  varying float vType;

  void main() {
    // Soft circular point with radiant core falloff
    vec2 coord = gl_PointCoord - vec2(0.5);
    float dist = length(coord);
    if (dist > 0.5) discard;

    // Smooth Gaussian-like falloff for luminous holographic glow
    float glow = 1.0 - smoothstep(0.0, 0.5, dist);
    glow = pow(glow, 1.4);

    // Hot bright white center spot
    float centerHot = 1.0 - smoothstep(0.0, 0.16, dist);
    vec3 finalColor = mix(vColor, vec3(1.0), centerHot * 0.65);

    gl_FragColor = vec4(finalColor, vAlpha * glow);
  }
`

/**
 * Procedural generation of the ~22,000 particles forming the supernatural
 * humanoid bust (head contours, amber face core, golden neck tendrils,
 * chest arc node, and flowing shoulder streamlines).
 */
function buildHumanoidGeometry() {
  const positions = new Float32Array(PARTICLE_COUNT * 3)
  const origins   = new Float32Array(PARTICLE_COUNT * 3)
  const orders    = new Float32Array(PARTICLE_COUNT)
  const types     = new Float32Array(PARTICLE_COUNT)
  const phases    = new Float32Array(PARTICLE_COUNT)
  const sizes     = new Float32Array(PARTICLE_COUNT)
  const colors    = new Float32Array(PARTICLE_COUNT * 3)

  let idx = 0

  function addPoint(
    x: number, y: number, z: number,
    order: number,
    type: number,
    size: number,
    r: number, g: number, b: number,
  ) {
    if (idx >= PARTICLE_COUNT) return

    const i3 = idx * 3
    positions[i3]     = x
    positions[i3 + 1] = y
    positions[i3 + 2] = z

    // Compute swirling spiral vortex origin (matching Reference Image 5)
    // Originates near bottom chest arc node and spirals outwards & upwards
    const spiralAngle = order * Math.PI * 5.2 + Math.random() * 0.6
    const spiralRadius = 0.12 + Math.pow(order, 0.85) * 2.1 + (Math.random() - 0.5) * 0.35
    const spiralY = -0.3 + Math.pow(order, 1.1) * 1.9 + (Math.random() - 0.5) * 0.25
    origins[i3]     = Math.cos(spiralAngle) * spiralRadius
    origins[i3 + 1] = spiralY
    origins[i3 + 2] = Math.sin(spiralAngle) * spiralRadius * 0.65

    orders[idx] = order
    types[idx]  = type
    phases[idx] = Math.random()
    sizes[idx]  = size

    colors[i3]     = r
    colors[i3 + 1] = g
    colors[i3 + 2] = b

    idx++
  }

  // --- 1. CHEST ARC REACTOR SINGULARITY NODE (~1,500 points) ---
  // Dense radiant sphere at sternum (0, -0.05, 0.25)
  const chestCount = 1500
  for (let i = 0; i < chestCount; i++) {
    const u = Math.random() * 2 - 1
    const theta = Math.random() * Math.PI * 2
    const rad = Math.pow(Math.random(), 2.2) * 0.14
    const x = Math.cos(theta) * Math.sqrt(1 - u * u) * rad
    const y = -0.05 + u * rad
    const z = 0.25 + Math.sin(theta) * Math.sqrt(1 - u * u) * rad * 0.75
    addPoint(x, y, z, 0.02 + Math.random() * 0.10, TYPE_CHEST_ARC, 3.8 + Math.random() * 2.5, 0.85, 0.98, 1.0)
  }

  // --- 2. GOLDEN NEURAL TENDRILS UP NECK (~1,800 points) ---
  // Electric filaments rising from chest node through throat to head
  const tendrilCount = 1800
  const numBranches = 7
  for (let i = 0; i < tendrilCount; i++) {
    const branch = i % numBranches
    const branchAngle = ((branch / numBranches) - 0.5) * 0.7
    const frac = (i / tendrilCount)
    const y = -0.05 + frac * 1.35
    // Sinusoidal lightning kinks
    const kink = Math.sin(frac * 18.0 + branch) * 0.035
    const x = Math.sin(branchAngle) * frac * 0.18 + kink
    const z = 0.25 - frac * 0.15 + Math.cos(frac * 14.0 + branch) * 0.025
    addPoint(
      x + (Math.random() - 0.5) * 0.015,
      y + (Math.random() - 0.5) * 0.015,
      z + (Math.random() - 0.5) * 0.015,
      0.25 + frac * 0.45,
      TYPE_GOLD_TENDRIL,
      3.2 + Math.random() * 1.8,
      1.0, 0.78, 0.18 // Rich electrical gold
    )
  }

  // --- 3. AMBER MIND & SPEECH CORE (HEAD CENTER) (~2,000 points) ---
  // Spherical glowing cluster inside head at (0, 1.32, 0.05)
  const amberCount = 2000
  for (let i = 0; i < amberCount; i++) {
    const u = Math.random() * 2 - 1
    const theta = Math.random() * Math.PI * 2
    const rad = Math.pow(Math.random(), 1.5) * 0.26
    const x = Math.cos(theta) * Math.sqrt(1 - u * u) * rad * 0.85
    const y = 1.32 + u * rad * 0.95
    const z = 0.05 + Math.sin(theta) * Math.sqrt(1 - u * u) * rad * 0.85
    // Center is hot orange/amber, edges soften
    const heat = 1.0 - (rad / 0.26)
    addPoint(
      x, y, z,
      0.82 + Math.random() * 0.16,
      TYPE_AMBER_CORE,
      3.2 + Math.random() * 2.2,
      1.0, 0.55 + heat * 0.35, 0.08 // Warm glowing amber/gold
    )
  }

  // --- 4. CRANIUM & FACE HORIZONTAL CONTOUR RINGS (~8,500 points) ---
  // 44 discrete horizontal scanline slices reproducing the exact look from images
  const headRings = 44
  const pointsPerRing = 195
  for (let r = 0; r < headRings; r++) {
    const frac = r / (headRings - 1)
    const y = 0.80 + frac * 1.15 // chin 0.80 up to crown 1.95

    let rx = 0.48
    let rz = 0.52
    let zCenter = 0.0

    if (y < 1.35) {
      // Facial/jaw tapering
      const jawFrac = (y - 0.80) / 0.55
      rx = 0.22 + jawFrac * 0.30
      rz = 0.24 + jawFrac * 0.26
      zCenter = 0.10 * (1.0 - jawFrac * 0.6)
    } else {
      // Cranium upper dome
      const domeFrac = (y - 1.35) / 0.60
      const domeShape = Math.sqrt(Math.max(0.01, 1.0 - domeFrac * domeFrac))
      rx = 0.52 * domeShape
      rz = 0.50 * domeShape
      zCenter = -0.02 * domeFrac
    }

    const order = 0.60 + frac * 0.35

    for (let p = 0; p < pointsPerRing; p++) {
      const angle = (p / pointsPerRing) * Math.PI * 2
      // Subtle anatomical facial indentation (flatter temples, eye sockets)
      let rScale = 1.0
      if (y > 1.05 && y < 1.45 && Math.sin(angle) > 0.3) {
        // Eye and brow contour relief
        rScale += Math.sin(angle * 4.0) * 0.025
      }

      const x = Math.cos(angle) * rx * rScale + (Math.random() - 0.5) * 0.012
      const z = zCenter + Math.sin(angle) * rz * rScale + (Math.random() - 0.5) * 0.012

      // Cyan contour line
      addPoint(
        x, y, z,
        order,
        TYPE_CYAN_CONTOUR,
        2.6 + Math.random() * 1.2,
        0.0, 0.88, 1.0 // Brilliant holographic cyan
      )
    }
  }

  // --- 5. NECK HORIZONTAL CONTOURS (~1,800 points) ---
  const neckRings = 16
  const pointsPerNeckRing = 110
  for (let nr = 0; nr < neckRings; nr++) {
    const frac = nr / (neckRings - 1)
    const y = 0.25 + frac * 0.52 // from sternum top to chin
    const rx = 0.25 + frac * 0.05
    const rz = 0.24 + frac * 0.04
    const order = 0.45 + frac * 0.15

    for (let p = 0; p < pointsPerNeckRing; p++) {
      const angle = (p / pointsPerNeckRing) * Math.PI * 2
      const x = Math.cos(angle) * rx + (Math.random() - 0.5) * 0.015
      const z = Math.sin(angle) * rz + (Math.random() - 0.5) * 0.015
      addPoint(
        x, y, z,
        order,
        TYPE_CYAN_CONTOUR,
        2.5 + Math.random() * 1.1,
        0.0, 0.84, 0.98
      )
    }
  }

  // --- 6. FLOWING SHOULDER & TORSO STREAMLINES (~5,000 points) ---
  // Beautiful magnetic / anatomical streamline curves flowing over shoulders
  const numStreamlines = 50
  const pointsPerStreamline = 100
  for (let s = 0; s < numStreamlines; s++) {
    const side = (s % 2 === 0 ? 1 : -1)
    const streamFrac = s / numStreamlines
    // Start near base of neck
    const startX = side * (0.22 + streamFrac * 0.12)
    const startY = 0.28 - streamFrac * 0.18
    const startZ = 0.08 + (Math.random() - 0.5) * 0.15

    // End out at deltoid edge
    const endX = side * (1.15 + streamFrac * 0.85)
    const endY = -0.35 - streamFrac * 0.35
    const endZ = -0.05 + (Math.random() - 0.5) * 0.25

    for (let p = 0; p < pointsPerStreamline; p++) {
      const pf = p / (pointsPerStreamline - 1)
      // Smooth curve with natural shoulder slope
      const cx = THREE.MathUtils.lerp(startX, endX, Math.pow(pf, 0.9))
      const cy = THREE.MathUtils.lerp(startY, endY, Math.pow(pf, 1.25)) + Math.sin(pf * Math.PI) * 0.08
      const cz = THREE.MathUtils.lerp(startZ, endZ, pf)

      // Outer shoulder tips dissipate into sparkling mist (Image 1 & 2)
      const isTip = pf > 0.75
      const jitter = isTip ? (pf - 0.75) * 0.18 : 0.018

      addPoint(
        cx + (Math.random() - 0.5) * jitter,
        cy + (Math.random() - 0.5) * jitter,
        cz + (Math.random() - 0.5) * jitter,
        0.12 + pf * 0.38,
        isTip ? TYPE_AURA_MIST : TYPE_CYAN_CONTOUR,
        isTip ? 2.0 + Math.random() * 2.2 : 2.5 + Math.random() * 1.3,
        0.05, 0.86, 1.0
      )
    }
  }

  // --- 7. FILL REMAINING SLOTS WITH AMBIENT PARTICLES (~remaining) ---
  while (idx < PARTICLE_COUNT) {
    const theta = Math.random() * Math.PI * 2
    const phi = Math.random() * Math.PI
    const r = 0.8 + Math.random() * 1.6
    addPoint(
      Math.sin(phi) * Math.cos(theta) * r,
      Math.cos(phi) * r + 0.6,
      Math.sin(phi) * Math.sin(theta) * r * 0.6,
      Math.random(),
      TYPE_AURA_MIST,
      1.8 + Math.random() * 1.5,
      0.0, 0.80, 1.0
    )
  }

  return { positions, origins, orders, types, phases, sizes, colors }
}

export function Humanoid({ drive }: { drive: Drive }) {
  const mat = useRef<THREE.ShaderMaterial>(null)
  const pts = useRef<THREE.Points>(null)
  const group = useRef<THREE.Group>(null)
  const viewport = useThree((s) => s.viewport)

  // Assembly sequence progress state (0.0 to 1.0)
  const assembleProgress = useRef(0.0)
  const assembleTarget   = useRef(1.0)
  const lastTrigger      = useRef(0)

  // Precomputed geometry buffer data
  const geoData = useMemo(() => buildHumanoidGeometry(), [])

  // Shader uniforms
  const uniforms = useMemo(
    () => ({
      uTime:        { value: 0 },
      uAssemble:    { value: 0.0 },
      uAudioLevel:  { value: 0 },
      uVoiceWave:   { value: 0 },
      uHeadYaw:     { value: 0 },
      uHeadPitch:   { value: 0 },
      uIntensity:   { value: 1.0 },
      uAccentColor: { value: new THREE.Color('#00f5ff') },
    }),
    [],
  )

  // Parallax target smoothing
  const smoothLook = useRef({ yaw: 0, pitch: 0 })

  // Listen to store triggers (such as clicking the Re-Assemble button)
  useEffect(() => {
    const unsub = useStore.subscribe((s) => {
      if (s.assembleTrigger !== lastTrigger.current) {
        lastTrigger.current = s.assembleTrigger
        assembleProgress.current = 0.0
        assembleTarget.current = 1.0
      }
    })
    return unsub
  }, [])

  useFrame((state, dt) => {
    if (!mat.current || !pts.current || !group.current) return
    const u = mat.current.uniforms
    const { phase, level, gestures } = useStore.getState()

    // --- 1. Assembly Clock & Progress ---
    // Smoothly advances the assembly animation from 0% to 100% over ~4.8 seconds
    if (assembleProgress.current < assembleTarget.current) {
      assembleProgress.current = Math.min(
        assembleTarget.current,
        assembleProgress.current + dt * 0.22,
      )
      // Update store for HUD readout ("ASSEMBLING ... xx%")
      useStore.getState().setAssembleProgress(Math.floor(assembleProgress.current * 100))
    }
    u.uAssemble.value = assembleProgress.current

    // --- 2. Time & Audio Reactivity ---
    u.uTime.value = state.clock.elapsedTime
    u.uIntensity.value = drive.reactor.intensity

    // Audio level smoothing
    u.uAudioLevel.value += (drive.level - u.uAudioLevel.value) * Math.min(1, dt * 9)

    // Voice modulation: heightened during speaking or active dialogue
    const isVoiceActive = phase === 'speaking' || level > 0.08
    const voiceTarget = isVoiceActive ? Math.max(0.4, drive.level * 1.5) : 0.0
    u.uVoiceWave.value += (voiceTarget - u.uVoiceWave.value) * Math.min(1, dt * 12)

    // Accent color sync
    ;(u.uAccentColor.value as THREE.Color).lerp(drive.color, Math.min(1, dt * 3))

    // --- 3. Interactive Parallax Head Tracking ---
    // Tracks mouse cursor or webcam hand coordinates smoothly
    let targetYaw = 0
    let targetPitch = 0

    if (hands.length > 0 && gestures) {
      const h = hands[0]
      const winW = typeof window !== 'undefined' ? window.innerWidth : 1920
      const winH = typeof window !== 'undefined' ? window.innerHeight : 1080
      targetYaw   = -((h.x / winW - 0.5) * 2) * 0.45
      targetPitch = -((h.y / winH - 0.5) * 2) * 0.32
    } else {
      // Natural idle tracking + subtle mouse influence
      const t = state.clock.elapsedTime
      targetYaw   = Math.sin(t * 0.35) * 0.12
      targetPitch = Math.cos(t * 0.45) * 0.08
    }

    smoothLook.current.yaw   += (targetYaw - smoothLook.current.yaw) * Math.min(1, dt * 4.5)
    smoothLook.current.pitch += (targetPitch - smoothLook.current.pitch) * Math.min(1, dt * 4.5)

    u.uHeadYaw.value   = smoothLook.current.yaw
    u.uHeadPitch.value = smoothLook.current.pitch

    // Fit framing to viewport: scale so bust is positioned perfectly in center
    const fit = Math.min(viewport.width, viewport.height)
    const scale = Math.min(1.2, (fit / 6.2) * 1.05) * drive.reactor.scale
    group.current.scale.setScalar(scale)
    // Offset slightly downwards so head and chest are well-balanced
    group.current.position.y = -0.55 * scale
  })

  return (
    <group ref={group}>
      <points ref={pts} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[geoData.positions, 3]} />
          <bufferAttribute attach="attributes-aOrigin"   args={[geoData.origins, 3]} />
          <bufferAttribute attach="attributes-aOrder"    args={[geoData.orders, 1]} />
          <bufferAttribute attach="attributes-aType"     args={[geoData.types, 1]} />
          <bufferAttribute attach="attributes-aPhase"    args={[geoData.phases, 1]} />
          <bufferAttribute attach="attributes-aSize"     args={[geoData.sizes, 1]} />
          <bufferAttribute attach="attributes-aColor"    args={[geoData.colors, 3]} />
        </bufferGeometry>
        <shaderMaterial
          ref={mat}
          uniforms={uniforms}
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>
    </group>
  )
}
