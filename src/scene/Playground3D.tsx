import { useRef, useState, useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useStore } from '../store'
import {
  hands,
  INDEX_TIP,
  THUMB_TIP,
  MIDDLE_TIP,
  RING_TIP,
  WRIST,
} from '../lib/hands'

export type ShapeType = 'stroke' | 'cube' | 'sphere' | 'pyramid' | 'torus' | 'reactor'

export type PlaygroundShape = {
  id: string
  type: ShapeType
  points: THREE.Vector3[]
  color: string
  position: THREE.Vector3
  rotation: THREE.Euler
  scale: number
}

/* ------------------------------------------------ 3D Prebuilt Wireframe Geometries */

function PrebuiltMesh({ shape, isHovered, isDragged }: { shape: PlaygroundShape; isHovered: boolean; isDragged: boolean }) {
  const meshRef = useRef<THREE.Group>(null)

  // Slow ambient rotation for prebuilt holographic shapes
  useFrame((_, delta) => {
    if (meshRef.current && shape.type !== 'stroke' && !isDragged) {
      meshRef.current.rotation.y += delta * 0.4
      meshRef.current.rotation.x += delta * 0.15
    }
  })

  const col = useMemo(() => new THREE.Color(isHovered ? '#ffffff' : shape.color), [shape.color, isHovered])

  if (shape.type === 'cube') {
    const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(1.2, 1.2, 1.2)), [])
    return (
      <group ref={meshRef}>
        <lineSegments geometry={edges}>
          <lineBasicMaterial color={col} linewidth={2} transparent opacity={0.9} />
        </lineSegments>
        <mesh>
          <boxGeometry args={[1.18, 1.18, 1.18]} />
          <meshBasicMaterial color={col} wireframe transparent opacity={0.15} />
        </mesh>
      </group>
    )
  }

  if (shape.type === 'sphere') {
    const geo = useMemo(() => new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(0.8, 2)), [])
    return (
      <group ref={meshRef}>
        <lineSegments geometry={geo}>
          <lineBasicMaterial color={col} linewidth={2} transparent opacity={0.9} />
        </lineSegments>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.78, 0.82, 32]} />
          <meshBasicMaterial color={col} side={THREE.DoubleSide} transparent opacity={0.6} />
        </mesh>
      </group>
    )
  }

  if (shape.type === 'pyramid') {
    const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.ConeGeometry(0.9, 1.3, 4)), [])
    return (
      <group ref={meshRef}>
        <lineSegments geometry={edges}>
          <lineBasicMaterial color={col} linewidth={2} transparent opacity={0.9} />
        </lineSegments>
        <mesh>
          <coneGeometry args={[0.88, 1.28, 4]} />
          <meshBasicMaterial color={col} wireframe transparent opacity={0.15} />
        </mesh>
      </group>
    )
  }

  if (shape.type === 'torus') {
    const geo = useMemo(() => new THREE.WireframeGeometry(new THREE.TorusGeometry(0.75, 0.22, 10, 24)), [])
    return (
      <group ref={meshRef}>
        <lineSegments geometry={geo}>
          <lineBasicMaterial color={col} linewidth={2} transparent opacity={0.9} />
        </lineSegments>
      </group>
    )
  }

  if (shape.type === 'reactor') {
    return (
      <group ref={meshRef}>
        {/* Outer Ring */}
        <mesh>
          <ringGeometry args={[0.85, 0.95, 36]} />
          <meshBasicMaterial color={col} side={THREE.DoubleSide} transparent opacity={0.85} />
        </mesh>
        {/* Inner Ring */}
        <mesh>
          <ringGeometry args={[0.42, 0.48, 36]} />
          <meshBasicMaterial color={col} side={THREE.DoubleSide} transparent opacity={0.95} />
        </mesh>
        {/* Power Core Triangle */}
        <mesh rotation={[0, 0, Math.PI / 6]}>
          <circleGeometry args={[0.3, 3]} />
          <meshBasicMaterial color={col} wireframe transparent opacity={0.8} />
        </mesh>
        {/* Radial Spokes */}
        {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
          <mesh key={deg} rotation={[0, 0, (deg * Math.PI) / 180]}>
            <planeGeometry args={[0.04, 0.45]} />
            <meshBasicMaterial color={col} side={THREE.DoubleSide} transparent opacity={0.7} />
          </mesh>
        ))}
      </group>
    )
  }

  return null
}

/* ------------------------------------------------ Main Playground Engine */

export function Playground3D() {
  const playground = useStore((s) => s.playground)
  const playgroundColor = useStore((s) => s.playgroundColor)

  const groupRef = useRef<THREE.Group>(null)
  const [shapes, setShapes] = useState<PlaygroundShape[]>([])
  const currentStrokeRef = useRef<THREE.Vector3[]>([])

  // Interaction tracking
  const draggedShapeIdRef = useRef<string | null>(null)
  const hoveredShapeIdRef = useRef<string | null>(null)
  const dragOffsetRef = useRef<THREE.Vector3>(new THREE.Vector3())
  const prevFistPosRef = useRef<THREE.Vector2 | null>(null)
  const prevFistAngleRef = useRef<number | null>(null)
  const isTouchActiveRef = useRef<boolean>(false)

  // Indicator visual meshes
  const pointerMeshRef = useRef<THREE.Group>(null)
  const drawTipMeshRef = useRef<THREE.Mesh>(null)
  const eraserMeshRef = useRef<THREE.Group>(null)
  const revolveGimbalRef = useRef<THREE.Group>(null)

  // Clear event listener
  useEffect(() => {
    const handleClear = () => {
      setShapes([])
      currentStrokeRef.current = []
      draggedShapeIdRef.current = null
      hoveredShapeIdRef.current = null
    }
    window.addEventListener('jarvis-playground-clear', handleClear)
    return () => window.removeEventListener('jarvis-playground-clear', handleClear)
  }, [])

  // Spawn prebuilt shapes event listener
  useEffect(() => {
    const handleSpawn = (e: Event) => {
      const ce = e as CustomEvent<{ type: ShapeType; color?: string }>
      const type = ce.detail?.type || 'cube'
      const color = ce.detail?.color || playgroundColor
      const offset = (shapes.length % 5 - 2) * 0.85
      const newShape: PlaygroundShape = {
        id: `shape_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type,
        points: [],
        color,
        position: new THREE.Vector3(offset, (Math.random() - 0.5) * 0.5, 0),
        rotation: new THREE.Euler(0, 0, 0),
        scale: 1,
      }
      setShapes((prev) => [...prev, newShape])
    }
    window.addEventListener('jarvis-playground-spawn-shape', handleSpawn)
    return () => window.removeEventListener('jarvis-playground-spawn-shape', handleSpawn)
  }, [playgroundColor, shapes.length])

  useFrame(() => {
    if (!playground || !groupRef.current) return

    const winW = typeof window !== 'undefined' ? window.innerWidth : 1920
    const winH = typeof window !== 'undefined' ? window.innerHeight : 1080
    const aspect = winW / winH

    // Visible world dimensions at z = 0 with camera FOV 45 at (0, 0, 6.2)
    const vHeight = 2 * Math.tan((45 / 2) * (Math.PI / 180)) * 6.2
    const vWidth = vHeight * aspect

    function toWorld(px: number, py: number): THREE.Vector3 {
      const wx = (px / winW - 0.5) * vWidth
      const wy = -(py / winH - 0.5) * vHeight
      return new THREE.Vector3(wx, wy, 0)
    }

    // Reset indicator visibility
    if (pointerMeshRef.current) pointerMeshRef.current.visible = false
    if (drawTipMeshRef.current) drawTipMeshRef.current.visible = false
    if (eraserMeshRef.current) eraserMeshRef.current.visible = false
    if (revolveGimbalRef.current) revolveGimbalRef.current.visible = false

    hoveredShapeIdRef.current = null

    if (hands.length === 0) {
      prevFistPosRef.current = null
      prevFistAngleRef.current = null
      draggedShapeIdRef.current = null
      isTouchActiveRef.current = false
      return
    }

    const h = hands[0]
    const f = h.fingers
    const pts = h.points

    if (!pts || pts.length < 21) return

    const pThumb = pts[THUMB_TIP]
    const pIndex = pts[INDEX_TIP]
    const pMiddle = pts[MIDDLE_TIP]
    const pRing = pts[RING_TIP]
    const wrist = pts[WRIST]
    const middleMcp = pts[9]

    // Physical touch contact detection (distance between thumb and index tips)
    const touchDistance = Math.hypot(pThumb.x - pIndex.x, pThumb.y - pIndex.y)
    const touchThreshold = Math.max(26, h.span * 0.20)
    const releaseThreshold = Math.max(45, h.span * 0.35)

    if (!isTouchActiveRef.current) {
      if (touchDistance < touchThreshold) {
        isTouchActiveRef.current = true
      }
    } else {
      if (touchDistance > releaseThreshold) {
        isTouchActiveRef.current = false
      }
    }
    const isPhysicalContact = isTouchActiveRef.current

    // Finger gestures
    const isFist = !f.index && !f.middle && !f.ring && !f.pinky
    const isPointer = f.index && !f.middle && !f.ring && !f.pinky && !isPhysicalContact
    const isDraw = f.index && f.middle && !f.ring && !f.pinky && !isPhysicalContact
    const isErase = f.index && f.middle && f.ring && !f.pinky
    // Palm (5 fingers) is neutral/idle

    const worldToGroup = new THREE.Matrix4().copy(groupRef.current.matrixWorld).invert()

    // ----------------------------------------------------
    // GESTURE 1: CLOSED FIST -> 3D ROTATE & REVOLVE
    // ----------------------------------------------------
    if (isFist) {
      if (revolveGimbalRef.current) {
        revolveGimbalRef.current.position.copy(groupRef.current.position)
        revolveGimbalRef.current.visible = true
      }

      const fistPos = new THREE.Vector2(wrist.x / winW, wrist.y / winH)
      const fistAngle = Math.atan2(middleMcp.y - wrist.y, middleMcp.x - wrist.x)

      if (prevFistPosRef.current !== null && prevFistAngleRef.current !== null) {
        const deltaX = (fistPos.x - prevFistPosRef.current.x) * 4.2
        const deltaY = (fistPos.y - prevFistPosRef.current.y) * 4.2

        let deltaAngle = fistAngle - prevFistAngleRef.current
        if (deltaAngle > Math.PI) deltaAngle -= 2 * Math.PI
        if (deltaAngle < -Math.PI) deltaAngle += 2 * Math.PI

        // Rotate object group around centroid
        groupRef.current.rotation.y += deltaX * 1.8
        groupRef.current.rotation.x -= deltaY * 1.8
        groupRef.current.rotation.z -= deltaAngle * 1.5

        // Revolve object group in 3D orbit
        groupRef.current.position.x += deltaX * 2.5
        groupRef.current.position.y -= deltaY * 2.5
      }

      prevFistPosRef.current = fistPos
      prevFistAngleRef.current = fistAngle
    } else {
      prevFistPosRef.current = null
      prevFistAngleRef.current = null
    }

    // ----------------------------------------------------
    // GESTURE 2: POINTER (Single Index Finger Only)
    // ----------------------------------------------------
    if (isPointer) {
      const worldPos = toWorld(pIndex.x, pIndex.y)
      if (pointerMeshRef.current) {
        pointerMeshRef.current.position.copy(worldPos)
        pointerMeshRef.current.visible = true
      }

      // Check if pointer is hovering over any shape
      const groupPos = worldPos.clone().applyMatrix4(worldToGroup)
      let closestDist = 0.8
      let hitId: string | null = null

      for (const s of shapes) {
        if (s.type === 'stroke') {
          for (const pt of s.points) {
            const d = pt.clone().add(s.position).distanceTo(groupPos)
            if (d < closestDist) {
              closestDist = d
              hitId = s.id
            }
          }
        } else {
          const d = s.position.distanceTo(groupPos)
          if (d < 0.9) {
            closestDist = d
            hitId = s.id
          }
        }
      }
      hoveredShapeIdRef.current = hitId
    }

    // ----------------------------------------------------
    // GESTURE 3: DRAW (Index + Middle Fingers Pointed)
    // ----------------------------------------------------
    if (isDraw) {
      // Draw from midpoint of index and middle fingertips
      const midX = (pIndex.x + pMiddle.x) / 2
      const midY = (pIndex.y + pMiddle.y) / 2
      const worldPos = toWorld(midX, midY)

      if (drawTipMeshRef.current) {
        drawTipMeshRef.current.position.copy(worldPos)
        drawTipMeshRef.current.visible = true
      }

      const groupPos = worldPos.clone().applyMatrix4(worldToGroup)
      const stroke = currentStrokeRef.current

      if (stroke.length === 0 || stroke[stroke.length - 1].distanceTo(groupPos) > 0.05) {
        stroke.push(groupPos)
      }
    } else if (currentStrokeRef.current.length > 0) {
      // Commit stroke
      if (currentStrokeRef.current.length > 1) {
        const newShape: PlaygroundShape = {
          id: `shape_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          type: 'stroke',
          points: [...currentStrokeRef.current],
          color: playgroundColor,
          position: new THREE.Vector3(0, 0, 0),
          rotation: new THREE.Euler(0, 0, 0),
          scale: 1,
        }
        setShapes((prev) => [...prev, newShape])
      }
      currentStrokeRef.current = []
    }

    // ----------------------------------------------------
    // GESTURE 4: ERASE (3 Fingers Pointed: Index, Middle, Ring)
    // ----------------------------------------------------
    if (isErase) {
      const midX = (pIndex.x + pMiddle.x + pRing.x) / 3
      const midY = (pIndex.y + pMiddle.y + pRing.y) / 3
      const worldPos = toWorld(midX, midY)

      if (eraserMeshRef.current) {
        eraserMeshRef.current.position.copy(worldPos)
        eraserMeshRef.current.visible = true
      }

      const eraserGroupPos = worldPos.clone().applyMatrix4(worldToGroup)
      const eraseRadius = 0.55

      setShapes((prevShapes) => {
        let changed = false
        const nextShapes: PlaygroundShape[] = []

        for (const s of prevShapes) {
          if (s.type === 'stroke') {
            const remainingPts = s.points.filter((pt) => {
              const ptWorld = pt.clone().add(s.position)
              return ptWorld.distanceTo(eraserGroupPos) > eraseRadius
            })
            if (remainingPts.length !== s.points.length) {
              changed = true
            }
            if (remainingPts.length > 1) {
              nextShapes.push({ ...s, points: remainingPts })
            }
          } else {
            // Prebuilt shape: delete if center is within radius
            if (s.position.distanceTo(eraserGroupPos) <= eraseRadius * 1.2) {
              changed = true
            } else {
              nextShapes.push(s)
            }
          }
        }
        return changed ? nextShapes : prevShapes
      })
    }

    // ----------------------------------------------------
    // GESTURE 5: PHYSICAL TOUCH DRAG & DROP (Thumb touches Index)
    // ----------------------------------------------------
    if (isPhysicalContact) {
      const midX = (pThumb.x + pIndex.x) / 2
      const midY = (pThumb.y + pIndex.y) / 2
      const touchWorld = toWorld(midX, midY)
      const touchGroup = touchWorld.clone().applyMatrix4(worldToGroup)

      if (!draggedShapeIdRef.current) {
        // Find nearest shape to grab
        let nearestDist = 1.0
        let hitShape: PlaygroundShape | null = null

        for (const s of shapes) {
          if (s.type === 'stroke') {
            for (const pt of s.points) {
              const actualPt = pt.clone().add(s.position)
              const d = actualPt.distanceTo(touchGroup)
              if (d < nearestDist) {
                nearestDist = d
                hitShape = s
              }
            }
          } else {
            const d = s.position.distanceTo(touchGroup)
            if (d < nearestDist) {
              nearestDist = d
              hitShape = s
            }
          }
        }

        if (hitShape) {
          draggedShapeIdRef.current = hitShape.id
          dragOffsetRef.current.copy(hitShape.position).sub(touchGroup)
        }
      } else {
        // Move dragged shape
        const targetId = draggedShapeIdRef.current
        setShapes((prev) =>
          prev.map((s) => {
            if (s.id === targetId) {
              return { ...s, position: touchGroup.clone().add(dragOffsetRef.current) }
            }
            return s
          })
        )
      }
    } else {
      draggedShapeIdRef.current = null
    }
  })

  if (!playground) return null

  return (
    <>
      {/* 3D Holographic Playground Objects Group */}
      <group ref={groupRef}>
        {shapes.map((s) => {
          const isHovered = hoveredShapeIdRef.current === s.id
          const isDragged = draggedShapeIdRef.current === s.id

          if (s.type === 'stroke') {
            const geom = new THREE.BufferGeometry().setFromPoints(s.points)
            return (
              <group key={s.id} position={s.position}>
                <primitive
                  object={
                    new THREE.Line(
                      geom,
                      new THREE.LineBasicMaterial({
                        color: new THREE.Color(isHovered ? '#ffffff' : s.color),
                        linewidth: 3,
                        transparent: true,
                        opacity: isHovered ? 1.0 : 0.95,
                      })
                    )
                  }
                />
                {(isDragged || isHovered) && (
                  <mesh>
                    <boxGeometry args={[1.2, 1.2, 0.4]} />
                    <meshBasicMaterial
                      color={new THREE.Color(isDragged ? '#00ffff' : '#ffaa00')}
                      wireframe
                      transparent
                      opacity={0.4}
                    />
                  </mesh>
                )}
              </group>
            )
          }

          return (
            <group key={s.id} position={s.position} rotation={s.rotation} scale={s.scale}>
              <PrebuiltMesh shape={s} isHovered={isHovered} isDragged={isDragged} />
              {(isDragged || isHovered) && (
                <mesh>
                  <boxGeometry args={[1.5, 1.5, 1.5]} />
                  <meshBasicMaterial
                    color={new THREE.Color(isDragged ? '#00ffff' : '#ffaa00')}
                    wireframe
                    transparent
                    opacity={0.45}
                  />
                </mesh>
              )}
            </group>
          )
        })}
      </group>

      {/* Holographic Aiming Pointer (Index Finger Pointed) */}
      <group ref={pointerMeshRef} visible={false}>
        <mesh>
          <ringGeometry args={[0.08, 0.12, 24]} />
          <meshBasicMaterial color={new THREE.Color('#00ffff')} side={THREE.DoubleSide} />
        </mesh>
        <mesh>
          <circleGeometry args={[0.03, 16]} />
          <meshBasicMaterial color={new THREE.Color('#ffffff')} side={THREE.DoubleSide} />
        </mesh>
        <mesh rotation={[0, 0, Math.PI / 4]}>
          <ringGeometry args={[0.18, 0.20, 4]} />
          <meshBasicMaterial color={new THREE.Color('#00ffff')} side={THREE.DoubleSide} transparent opacity={0.6} />
        </mesh>
      </group>

      {/* Drawing Fingertip Spark Cursor (Index + Middle Pointed) */}
      <mesh ref={drawTipMeshRef} visible={false}>
        <sphereGeometry args={[0.07, 16, 16]} />
        <meshBasicMaterial color={new THREE.Color(playgroundColor)} />
      </mesh>

      {/* Holographic Eraser Indicator (3 Fingers Pointed) */}
      <group ref={eraserMeshRef} visible={false}>
        <mesh>
          <ringGeometry args={[0.42, 0.50, 32]} />
          <meshBasicMaterial color={new THREE.Color('#ff2244')} side={THREE.DoubleSide} transparent opacity={0.8} />
        </mesh>
        <mesh>
          <circleGeometry args={[0.40, 32]} />
          <meshBasicMaterial color={new THREE.Color('#ff0033')} side={THREE.DoubleSide} transparent opacity={0.2} />
        </mesh>
      </group>

      {/* Holographic 3D Revolve & Orbit Gimbal (Closed Fist) */}
      <group ref={revolveGimbalRef} visible={false}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[2.5, 0.02, 16, 64]} />
          <meshBasicMaterial color={new THREE.Color('#00f3ff')} transparent opacity={0.7} />
        </mesh>
        <mesh rotation={[0, Math.PI / 2, 0]}>
          <torusGeometry args={[2.5, 0.02, 16, 64]} />
          <meshBasicMaterial color={new THREE.Color('#ffaa00')} transparent opacity={0.7} />
        </mesh>
        <mesh>
          <torusGeometry args={[2.5, 0.02, 16, 64]} />
          <meshBasicMaterial color={new THREE.Color('#cc00ff')} transparent opacity={0.7} />
        </mesh>
      </group>
    </>
  )
}
