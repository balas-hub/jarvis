import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Drive } from './Scene'
import { useStore } from '../store'

/**
 * Holographic Synthetic Avatar
 *
 * Implements the 3D holographic entity from the user reference imagery:
 * 1. Head: 54 stacked horizontal contour rings (striations) that ripple with audio.
 * 2. Voice/Mind Core: Warm solar amber glowing nucleus inside the face/mouth that pulses with speech.
 * 3. Chest Arc Singularity: Brilliant radiant white-cyan star node at the clavicle.
 * 4. Neck Neural Filaments: Vertical branching golden lightning channels.
 * 5. Shoulders: Cascading cyan streamlines sweeping outward and dissolving into space dust.
 * 6. Vortex Assembly: Dynamic helical particle stream assembling from bottom-up (uAssemble 0 -> 1).
 */

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uLevel;
  uniform float uAssemble;
  uniform vec3  uColor;
  uniform vec3  uVoiceColor;
  uniform vec3  uChestColor;
  uniform float uPointSize;

  attribute float aType;
  attribute float aSeed;
  attribute vec3  aVortex;
  attribute vec2  aRingInfo;

  varying vec3  vColor;
  varying float vAlpha;
  varying float vType;

  void main() {
    vType = aType;
    
    // -- 1. Progressive Assembly Cascade --------------------------------------
    // Stagger particle arrival based on type and seed:
    // Chest star -> Shoulder streamlines -> Neck filaments -> Head contours -> Voice core
    float startT = 0.0;
    if (aType == 2.0) {
      startT = aSeed * 0.15; // Chest star ignites first
    } else if (aType == 4.0) {
      startT = 0.12 + aSeed * 0.38; // Shoulders
    } else if (aType == 3.0) {
      startT = 0.30 + aSeed * 0.35; // Neck filaments
    } else if (aType == 0.0) {
      startT = 0.40 + aSeed * 0.42; // Head contours
    } else {
      startT = 0.60 + aSeed * 0.35; // Voice core awakens last
    }

    float progress = clamp((uAssemble - startT) / 0.38, 0.0, 1.0);
    // Smooth non-linear cubic easing into place
    float ease = smoothstep(0.0, 1.0, progress);

    // -- 2. Vortex Singularity Position (Unassembled state) -------------------
    // Swirling helical vortex erupting upwards from the bottom singularity
    float tVortex = uTime * 2.6 + aVortex.x * 6.28318;
    float vRad = (0.15 + aVortex.y * 1.5) * (1.0 - ease * 0.65);
    float vHeight = -1.02 + aVortex.z * 3.2 + sin(tVortex * 0.8) * 0.3;
    
    // Sweeping logarithmic curved spiral (matching Image 5)
    float sweep = (vHeight + 1.02) * 1.2;
    vec3 vortexPos = vec3(
      cos(tVortex + sweep) * vRad + sweep * 0.38,
      vHeight,
      sin(tVortex + sweep) * vRad * 0.55
    );

    // Interpolate from vortex trajectory into final avatar posture
    vec3 targetPos = position;
    vec3 curPos = mix(vortexPos, targetPos, ease);

    // -- 3. Audio Reactivity & Idle Dynamics (when assembled) -----------------
    if (ease > 0.05) {
      // Gentle breathing motion
      float breathe = sin(uTime * 1.3 + curPos.y * 1.5) * 0.012;
      curPos.y += breathe;

      // Distance to inner voice core (located at mouth/face center)
      vec3 voiceCenter = vec3(0.0, 0.46, 0.15);
      float dVoice = length(targetPos - voiceCenter);

      // Head Contours (Type 0)
      if (aType == 0.0) {
        // Horizontal waveform ripple around the mouth/jaw during voice activity
        if (dVoice < 0.45) {
          float wave = sin(aRingInfo.y * 10.0 + uTime * 14.0) * cos(aRingInfo.x * 20.0);
          float voiceInfluence = (1.0 - dVoice / 0.45) * (uLevel * 0.04);
          curPos.x += wave * voiceInfluence;
          curPos.z += wave * voiceInfluence * 0.8;
          curPos.y += cos(aRingInfo.y * 6.0) * voiceInfluence * 0.5;
        }
      }

      // Neck Neural Filaments (Type 3)
      if (aType == 3.0) {
        // High-frequency electric jitter
        float spark = sin(uTime * 30.0 + aSeed * 25.0) * 0.006;
        curPos.x += spark;
        curPos.z += spark;
      }

      // Shoulder Dispersal Streamlines (Type 4)
      if (aType == 4.0) {
        // Outer particles drift softly in space
        float edge = smoothstep(0.7, 2.2, abs(curPos.x));
        curPos.x += sin(uTime * 1.1 + aSeed * 12.0) * (0.04 * edge);
        curPos.y += cos(uTime * 1.3 + aSeed * 15.0) * (0.03 * edge);
        curPos.z += sin(uTime * 0.9 + aSeed * 9.0) * (0.03 * edge);
      }
    }

    vec4 mv = modelViewMatrix * vec4(curPos, 1.0);
    gl_Position = projectionMatrix * mv;

    // -- 4. Color & Illumination Calculations ---------------------------------
    vec3 finalColor = uColor;
    float alpha = 0.85;

    // Type 0: Head Contours (Electric cyan transitioning to solar amber at voice core)
    if (aType == 0.0) {
      vec3 voiceCenter = vec3(0.0, 0.46, 0.15);
      float dVoice = length(targetPos - voiceCenter);
      float voiceHeat = clamp(1.0 - dVoice / 0.44, 0.0, 1.0);
      voiceHeat = pow(voiceHeat, 1.6) * (0.55 + uLevel * 1.9);

      // Blend from cyan to radiant solar amber/gold
      finalColor = mix(uColor, uVoiceColor, clamp(voiceHeat, 0.0, 1.0));
      if (voiceHeat > 1.0) {
        finalColor = mix(finalColor, vec3(1.0, 0.96, 0.85), clamp((voiceHeat - 1.0) * 0.6, 0.0, 1.0));
      }
      alpha = 0.55 + voiceHeat * 0.45;
    }
    // Type 1: Voice/Mind Core (Solar amber nucleus)
    else if (aType == 1.0) {
      finalColor = mix(uVoiceColor, vec3(1.0, 0.92, 0.7), uLevel * 0.5);
      alpha = (0.7 + uLevel * 0.5) * ease;
    }
    // Type 2: Chest Arc Singularity (Blazing radiant white-cyan)
    else if (aType == 2.0) {
      finalColor = uChestColor;
      alpha = 1.0;
    }
    // Type 3: Neck Neural Filaments (Golden electric channels)
    else if (aType == 3.0) {
      float pulse = fract(uTime * 2.0 - curPos.y * 1.2 + aSeed * 0.5);
      float glow = smoothstep(0.0, 0.12, pulse) * smoothstep(0.28, 0.12, pulse);
      finalColor = mix(uVoiceColor * 0.9, vec3(1.0, 0.95, 0.8), glow);
      alpha = (0.5 + glow * 0.5) * ease;
    }
    // Type 4: Shoulder Streamlines (Electric cyan dissolving at edges)
    else if (aType == 4.0) {
      float fade = exp(-abs(curPos.x) * 0.75);
      finalColor = uColor;
      alpha = (0.75 * fade + 0.1) * ease;
    }

    // Flash upon snapping into place
    if (ease > 0.01 && ease < 0.99) {
      float arrivalFlash = sin(ease * 3.14159) * 0.5;
      finalColor += vec3(arrivalFlash);
    }

    vColor = finalColor;
    vAlpha = alpha * (0.4 + ease * 0.6);

    // Point sizing with view-depth perspective
    float baseSize = uPointSize;
    if (aType == 2.0) baseSize *= 2.2; // Chest singularity is bolder
    if (aType == 1.0) baseSize *= (1.2 + uLevel * 0.8); // Voice core expands
    gl_PointSize = baseSize * (15.0 / -mv.z);
  }
`

const fragmentShader = /* glsl */ `
  varying vec3  vColor;
  varying float vAlpha;
  varying float vType;

  void main() {
    vec2 coord = gl_PointCoord - 0.5;
    float r = length(coord);
    if (r > 0.5) discard;

    // Smooth Gaussian-like circular falloff for holographic radiance
    float falloff = pow(1.0 - r * 2.0, 1.6);
    
    // Core specular hotspot in center
    float hotspot = smoothstep(0.18, 0.0, r) * 0.4;
    vec3 col = vColor + vec3(hotspot);

    gl_FragColor = vec4(col, vAlpha * falloff);
  }
`

export function HoloAvatar({ drive }: { drive: Drive }) {
  const pointsRef = useRef<THREE.Points>(null)
  const matRef = useRef<THREE.ShaderMaterial>(null)

  // Generate the 3D anatomical holographic bust geometry
  const { positions, types, seeds, vortices, ringInfos } = useMemo(() => {
    const posList: number[] = []
    const typeList: number[] = []
    const seedList: number[] = []
    const vortexList: number[] = []
    const ringInfoList: number[] = []

    const addPoint = (
      x: number,
      y: number,
      z: number,
      type: number,
      ringY = 0,
      ringAngle = 0,
    ) => {
      posList.push(x, y, z)
      typeList.push(type)
      seedList.push(Math.random())
      vortexList.push(Math.random(), Math.random(), Math.random())
      ringInfoList.push(ringY, ringAngle)
    }

    // =========================================================================
    // 1. HEAD CONTOUR RINGS (Type 0)
    // 54 horizontal latitude slices creating the scanned topographic face
    // =========================================================================
    const HEAD_SLICES = 54
    const POINTS_PER_SLICE = 120

    for (let i = 0; i < HEAD_SLICES; i++) {
      const frac = i / (HEAD_SLICES - 1)
      // y spans from -0.05 (chin) to 1.25 (top of head)
      const y = -0.05 + frac * 1.30

      // Anatomical human skull cross-section dimensions
      let rx = 0.38
      let rz = 0.46

      if (frac < 0.28) {
        // Jaw & chin region: tapering down
        const t = frac / 0.28
        rx = 0.22 + t * 0.22
        rz = 0.26 + t * 0.22
      } else if (frac < 0.65) {
        // Mouth, nose, cheekbones, temples: widest width
        const t = (frac - 0.28) / 0.37
        rx = 0.44 + Math.sin(t * Math.PI) * 0.08
        rz = 0.48 + Math.sin(t * Math.PI) * 0.05
      } else {
        // Forehead and cranial dome: curving back smoothly to apex
        const t = (frac - 0.65) / 0.35
        const dome = Math.sqrt(Math.max(0.0, 1.0 - t * t))
        rx = 0.48 * dome
        rz = 0.50 * dome
      }

      for (let j = 0; j < POINTS_PER_SLICE; j++) {
        const theta = (j / POINTS_PER_SLICE) * Math.PI * 2
        // Slight facial curvature: front is slightly flattened, temples indented
        const faceModZ = Math.cos(theta) > 0 ? 1.0 : 1.15
        const x = Math.sin(theta) * rx
        const z = Math.cos(theta) * rz * faceModZ + 0.08

        addPoint(x, y, z, 0.0, y, theta)
      }
    }

    // =========================================================================
    // 2. INNER VOICE / MIND CORE (Type 1)
    // Clustered sphere of solar energy inside the face/mouth cavity
    // =========================================================================
    const VOICE_CORE_COUNT = 1400
    const voiceCenterX = 0.0
    const voiceCenterY = 0.46
    const voiceCenterZ = 0.16

    for (let i = 0; i < VOICE_CORE_COUNT; i++) {
      const u = Math.random() * 2 - 1
      const theta = Math.random() * Math.PI * 2
      const rad = Math.pow(Math.random(), 1.8) * 0.28
      const rPlane = Math.sqrt(1 - u * u) * rad

      const x = voiceCenterX + Math.cos(theta) * rPlane
      const y = voiceCenterY + u * rad * 0.85
      const z = voiceCenterZ + Math.sin(theta) * rPlane

      addPoint(x, y, z, 1.0)
    }

    // =========================================================================
    // 3. CHEST ARC SINGULARITY (Type 2)
    // Blazing radiant white-cyan star with flare rays at the clavicle
    // =========================================================================
    const chestX = 0.0
    const chestY = -1.02
    const chestZ = 0.06

    // Concentrated singularity node
    for (let i = 0; i < 450; i++) {
      const u = Math.random() * 2 - 1
      const theta = Math.random() * Math.PI * 2
      const rad = Math.pow(Math.random(), 2.2) * 0.16
      const rPlane = Math.sqrt(1 - u * u) * rad

      addPoint(
        chestX + Math.cos(theta) * rPlane,
        chestY + u * rad,
        chestZ + Math.sin(theta) * rPlane,
        2.0,
      )
    }

    // Radiant flare star spikes
    const FLARE_POINTS = 350
    for (let i = 0; i < FLARE_POINTS; i++) {
      const arm = Math.floor(Math.random() * 4) // 4 primary axes
      const dist = 0.05 + Math.pow(Math.random(), 1.5) * 0.45
      const jitter = (Math.random() - 0.5) * 0.02
      let fx = 0
      let fy = 0

      if (arm === 0) { fx = dist; fy = jitter } // right
      else if (arm === 1) { fx = -dist; fy = jitter } // left
      else if (arm === 2) { fx = jitter; fy = dist } // up
      else { fx = jitter; fy = -dist } // down

      addPoint(chestX + fx, chestY + fy, chestZ + (Math.random() - 0.5) * 0.03, 2.0)
    }

    // =========================================================================
    // 4. NECK NEURAL FILAMENTS (Type 3)
    // Vertical branching energy channels from chest singularity up to head
    // =========================================================================
    const FILAMENT_COUNT = 16
    const POINTS_PER_FILAMENT = 65

    for (let f = 0; f < FILAMENT_COUNT; f++) {
      const spread = (f / (FILAMENT_COUNT - 1) - 0.5) * 2 // -1 .. 1
      const isCentral = Math.abs(spread) < 0.25

      for (let p = 0; p < POINTS_PER_FILAMENT; p++) {
        const t = p / (POINTS_PER_FILAMENT - 1) // 0 at chest, 1 at jaw
        const y = chestY + t * (voiceCenterY - chestY)

        // Branching profile: narrow at chest, widening across neck, gathering at jaw
        const neckWidth = Math.sin(t * Math.PI * 0.8) * 0.22
        const branchCurve = spread * neckWidth
        const jitter = (Math.sin(t * 18.0 + f * 4.0) * 0.015)

        const x = branchCurve + jitter
        const z = chestZ + Math.cos(t * Math.PI * 0.5) * 0.12 + (isCentral ? 0.03 : 0.0)

        addPoint(x, y, z, 3.0, y, spread)
      }
    }

    // =========================================================================
    // 5. SHOULDERS & CASCADING STREAMLINES (Type 4)
    // Flowing particle streamlines sweeping from clavicle out to shoulders
    // =========================================================================
    const STREAMLINE_COUNT = 48
    const POINTS_PER_STREAM = 110

    for (let s = 0; s < STREAMLINE_COUNT; s++) {
      const side = s % 2 === 0 ? 1 : -1
      const streamFrac = Math.floor(s / 2) / (STREAMLINE_COUNT / 2)
      // Clavicle origin
      const startX = side * (0.15 + streamFrac * 0.25)
      const startY = -0.75 - streamFrac * 0.22
      const startZ = (streamFrac - 0.5) * 0.2

      // Shoulder sweep destination
      const endX = side * (1.1 + streamFrac * 1.1)
      const endY = -1.35 - streamFrac * 0.45
      const endZ = (Math.random() - 0.5) * 0.4

      for (let p = 0; p < POINTS_PER_STREAM; p++) {
        const t = p / (POINTS_PER_STREAM - 1)
        // Quadratic bezier trajectory over the trapezius and shoulder deltoid
        const midX = side * (0.65 + streamFrac * 0.45)
        const midY = startY + 0.15 - Math.pow(t, 1.5) * 0.35
        const midZ = startZ

        // Bezier interpolation
        const u = 1 - t
        const x = u * u * startX + 2 * u * t * midX + t * t * endX
        const y = u * u * startY + 2 * u * t * midY + t * t * endY
        const z = u * u * startZ + 2 * u * t * midZ + t * t * endZ

        addPoint(x, y, z, 4.0, y, t)
      }
    }

    return {
      positions: new Float32Array(posList),
      types: new Float32Array(typeList),
      seeds: new Float32Array(seedList),
      vortices: new Float32Array(vortexList),
      ringInfos: new Float32Array(ringInfoList),
    }
  }, [])

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uLevel: { value: 0 },
      uAssemble: { value: 0 },
      uColor: { value: new THREE.Color('#00f0ff') },
      uVoiceColor: { value: new THREE.Color('#ffaa00') },
      uChestColor: { value: new THREE.Color('#eafaff') },
      uPointSize: { value: 3.2 },
    }),
    [],
  )

  useFrame((state, dt) => {
    if (!matRef.current || !pointsRef.current) return

    const { phase, assembleProgress } = useStore.getState()
    const t = state.clock.elapsedTime
    uniforms.uTime.value = t
    uniforms.uLevel.value = drive.level

    // Update color identity
    uniforms.uColor.value.copy(drive.color)
    if (phase === 'speaking') {
      uniforms.uVoiceColor.value.set('#ff9900')
    } else if (phase === 'thinking') {
      uniforms.uVoiceColor.value.set('#ffbb33')
    } else {
      uniforms.uVoiceColor.value.set('#ffaa00')
    }

    // Assembly Progression:
    // When in 'offline', assemble = 0 (dormant singularity)
    // When in 'boot', assemble tracks assembleProgress (0 -> 1)
    // In live operation ('dormant', 'listening', 'speaking', etc.), assemble = 1
    let targetAssemble = 1.0
    if (phase === 'offline') {
      targetAssemble = 0.05
    } else if (phase === 'boot') {
      targetAssemble = assembleProgress
    } else {
      targetAssemble = 1.0
    }

    // Smooth lerp to prevent harsh jumps
    uniforms.uAssemble.value +=
      (targetAssemble - uniforms.uAssemble.value) * Math.min(1, dt * 6.0)

    // Interactive 3D Parallax:
    // Subtly rotate the holographic avatar towards the mouse pointer / camera
    const pointer = state.pointer
    const targetRotY = pointer.x * 0.16
    const targetRotX = -pointer.y * 0.10

    pointsRef.current.rotation.y +=
      (targetRotY - pointsRef.current.rotation.y) * Math.min(1, dt * 4.0)
    pointsRef.current.rotation.x +=
      (targetRotX - pointsRef.current.rotation.x) * Math.min(1, dt * 4.0)
  })

  return (
    <points ref={pointsRef} position={[0, -0.15, 0]}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
        <bufferAttribute
          attach="attributes-aType"
          args={[types, 1]}
        />
        <bufferAttribute
          attach="attributes-aSeed"
          args={[seeds, 1]}
        />
        <bufferAttribute
          attach="attributes-aVortex"
          args={[vortices, 3]}
        />
        <bufferAttribute
          attach="attributes-aRingInfo"
          args={[ringInfos, 2]}
        />
      </bufferGeometry>
      <shaderMaterial
        ref={matRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  )
}
