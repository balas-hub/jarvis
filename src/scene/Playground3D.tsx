import { useRef, useState, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useStore } from '../store'
import { hands, INDEX_TIP, THUMB_TIP, MIDDLE_TIP, WRIST } from '../lib/hands'

export type DrawnShape = {
  id: string
  points: THREE.Vector3[]
  color: string
  position: THREE.Vector3
}

export function Playground3D() {
  const playground = useStore((s) => s.playground)
  const playgroundColor = useStore((s) => s.playgroundColor)

  const groupRef = useRef<THREE.Group>(null)
  const [shapes, setShapes] = useState<DrawnShape[]>([])
  const currentStrokeRef = useRef<THREE.Vector3[]>([])

  // Interaction states
  const draggedShapeIdRef = useRef<string | null>(null)
  const dragOffsetRef = useRef<THREE.Vector3>(new THREE.Vector3())
  const prevHandAngleRef = useRef<number | null>(null)
  const prevHandPosRef = useRef<THREE.Vector2 | null>(null)

  // Indicator refs
  const eraserMeshRef = useRef<THREE.Mesh>(null)
  const drawTipMeshRef = useRef<THREE.Mesh>(null)
  const gimbalRef = useRef<THREE.Group>(null)

  // Listen for clear events from HUD
  useEffect(() => {
    const handleClear = () => {
      setShapes([])
      currentStrokeRef.current = []
    }
    window.addEventListener('jarvis-playground-clear', handleClear)
    return () => window.removeEventListener('jarvis-playground-clear', handleClear)
  }, [])

  useFrame(() => {
    if (!playground || !groupRef.current) return

    const winW = typeof window !== 'undefined' ? window.innerWidth : 1920
    const winH = typeof window !== 'undefined' ? window.innerHeight : 1080
    const aspect = winW / winH

    // Visible world dimensions at z = 0 with camera at (0, 0, 6.2) and FOV 45
    const vHeight = 2 * Math.tan((45 / 2) * (Math.PI / 180)) * 6.2
    const vWidth = vHeight * aspect

    function toWorld(px: number, py: number): THREE.Vector3 {
      const wx = (px / winW - 0.5) * vWidth
      const wy = -(py / winH - 0.5) * vHeight
      return new THREE.Vector3(wx, wy, 0)
    }

    // Hide indicators by default
    if (eraserMeshRef.current) eraserMeshRef.current.visible = false
    if (drawTipMeshRef.current) drawTipMeshRef.current.visible = false
    if (gimbalRef.current) gimbalRef.current.visible = false

    if (hands.length === 0) {
      prevHandAngleRef.current = null
      prevHandPosRef.current = null
      draggedShapeIdRef.current = null
      return
    }

    const h = hands[0]
    const f = h.fingers
    const pts = h.points

    if (!pts || pts.length < 21) return

    // 1. Gesture Detection
    const isIndexOnly = f.index && !f.middle && !f.ring && !f.pinky
    const isErase = f.index && f.middle && !f.ring && !f.pinky
    const isPinch = h.pinched
    const is5Fingers = f.thumb && f.index && f.middle && f.ring && f.pinky

    // Convert local group inverted transform to place strokes inside the rotated/scaled group
    const worldToGroup = new THREE.Matrix4().copy(groupRef.current.matrixWorld).invert()

    // ----------------------------------------------------
    // GESTURE 1: DRAW (Index finger pointed)
    // ----------------------------------------------------
    if (isIndexOnly) {
      const tip = pts[INDEX_TIP]
      const worldPos = toWorld(tip.x, tip.y)
      
      // Position draw tip reticle
      if (drawTipMeshRef.current) {
        drawTipMeshRef.current.position.copy(worldPos)
        drawTipMeshRef.current.visible = true
      }

      // Transform world position to group space
      const groupPos = worldPos.clone().applyMatrix4(worldToGroup)
      const stroke = currentStrokeRef.current

      if (stroke.length === 0 || stroke[stroke.length - 1].distanceTo(groupPos) > 0.05) {
        stroke.push(groupPos)
      }
    } else if (currentStrokeRef.current.length > 0) {
      // Stroke ended -> Commit to shapes
      if (currentStrokeRef.current.length > 1) {
        const newShape: DrawnShape = {
          id: `shape_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          points: [...currentStrokeRef.current],
          color: playgroundColor,
          position: new THREE.Vector3(0, 0, 0),
        }
        setShapes((prev) => [...prev, newShape])
      }
      currentStrokeRef.current = []
    }

    // ----------------------------------------------------
    // GESTURE 2: ERASE (Index + Middle fingers pointed)
    // ----------------------------------------------------
    if (isErase) {
      const pIndex = pts[INDEX_TIP]
      const pMiddle = pts[MIDDLE_TIP]
      const midX = (pIndex.x + pMiddle.x) / 2
      const midY = (pIndex.y + pMiddle.y) / 2
      const worldPos = toWorld(midX, midY)

      if (eraserMeshRef.current) {
        eraserMeshRef.current.position.copy(worldPos)
        eraserMeshRef.current.visible = true
      }

      const eraserGroupPos = worldPos.clone().applyMatrix4(worldToGroup)
      const eraseRadius = 0.45

      // Erase points within radius
      setShapes((prevShapes) => {
        let changed = false
        const nextShapes: DrawnShape[] = []

        for (const s of prevShapes) {
          // Check points of shape relative to its position
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
        }
        return changed ? nextShapes : prevShapes
      })
    }

    // ----------------------------------------------------
    // GESTURE 3: DRAG AND DROP (Pinch thumb + index)
    // ----------------------------------------------------
    if (isPinch) {
      const pThumb = pts[THUMB_TIP]
      const pIndex = pts[INDEX_TIP]
      const midX = (pThumb.x + pIndex.x) / 2
      const midY = (pThumb.y + pIndex.y) / 2
      const pinchWorld = toWorld(midX, midY)
      const pinchGroup = pinchWorld.clone().applyMatrix4(worldToGroup)

      if (!draggedShapeIdRef.current) {
        // Find nearest shape to grab
        let nearestDist = 0.8
        let hitShape: DrawnShape | null = null

        for (const s of shapes) {
          for (const pt of s.points) {
            const actualPt = pt.clone().add(s.position)
            const d = actualPt.distanceTo(pinchGroup)
            if (d < nearestDist) {
              nearestDist = d
              hitShape = s
            }
          }
        }

        if (hitShape) {
          draggedShapeIdRef.current = hitShape.id
          dragOffsetRef.current.copy(hitShape.position).sub(pinchGroup)
        }
      } else {
        // Drag active shape
        const targetId = draggedShapeIdRef.current
        setShapes((prev) =>
          prev.map((s) => {
            if (s.id === targetId) {
              return { ...s, position: pinchGroup.clone().add(dragOffsetRef.current) }
            }
            return s
          })
        )
      }
    } else {
      draggedShapeIdRef.current = null
    }

    // ----------------------------------------------------
    // GESTURE 4: 3D ROTATE (All 5 fingers open)
    // ----------------------------------------------------
    if (is5Fingers) {
      if (gimbalRef.current) {
        gimbalRef.current.visible = true
      }

      const wrist = pts[WRIST]
      const middleMcp = pts[9]
      const handAngle = Math.atan2(middleMcp.y - wrist.y, middleMcp.x - wrist.x)
      const handPos = new THREE.Vector2(wrist.x / winW, wrist.y / winH)

      if (prevHandAngleRef.current !== null && prevHandPosRef.current !== null) {
        let deltaAngle = handAngle - prevHandAngleRef.current
        // Clamp sudden wrap-around at PI/-PI
        if (deltaAngle > Math.PI) deltaAngle -= 2 * Math.PI
        if (deltaAngle < -Math.PI) deltaAngle += 2 * Math.PI

        const deltaX = (handPos.x - prevHandPosRef.current.x) * 4.0
        const deltaY = (handPos.y - prevHandPosRef.current.y) * 4.0

        groupRef.current.rotation.z -= deltaAngle * 1.5
        groupRef.current.rotation.y += deltaX * 1.2
        groupRef.current.rotation.x -= deltaY * 1.2
      }

      prevHandAngleRef.current = handAngle
      prevHandPosRef.current = handPos
    } else {
      prevHandAngleRef.current = null
      prevHandPosRef.current = null
    }
  })

  if (!playground) return null

  return (
    <>
      {/* 3D Holographic Drawing Group */}
      <group ref={groupRef}>
        {shapes.map((s) => {
          const geom = new THREE.BufferGeometry().setFromPoints(s.points)
          return (
            <group key={s.id} position={s.position}>
              <primitive
                object={
                  new THREE.Line(
                    geom,
                    new THREE.LineBasicMaterial({
                      color: new THREE.Color(s.color),
                      linewidth: 3,
                      transparent: true,
                      opacity: 0.95,
                    })
                  )
                }
              />
              {/* Highlight bounding box if currently dragged */}
              {draggedShapeIdRef.current === s.id && (
                <mesh>
                  <boxGeometry args={[1.2, 1.2, 0.4]} />
                  <meshBasicMaterial
                    color={new THREE.Color('#00ffff')}
                    wireframe
                    transparent
                    opacity={0.4}
                  />
                </mesh>
              )}
            </group>
          )
        })}
      </group>

      {/* Draw fingertip spark cursor */}
      <mesh ref={drawTipMeshRef} visible={false}>
        <sphereGeometry args={[0.06, 16, 16]} />
        <meshBasicMaterial color={new THREE.Color(playgroundColor)} />
      </mesh>

      {/* Holographic Eraser Ring */}
      <mesh ref={eraserMeshRef} visible={false}>
        <ringGeometry args={[0.38, 0.44, 32]} />
        <meshBasicMaterial color={new THREE.Color('#ff3344')} side={THREE.DoubleSide} />
      </mesh>

      {/* Holographic 3D Rotation Gimbal */}
      <group ref={gimbalRef} visible={false}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[2.2, 0.02, 16, 64]} />
          <meshBasicMaterial color={new THREE.Color('#00ffff')} transparent opacity={0.6} />
        </mesh>
        <mesh rotation={[0, Math.PI / 2, 0]}>
          <torusGeometry args={[2.2, 0.02, 16, 64]} />
          <meshBasicMaterial color={new THREE.Color('#ff00aa')} transparent opacity={0.6} />
        </mesh>
        <mesh>
          <torusGeometry args={[2.2, 0.02, 16, 64]} />
          <meshBasicMaterial color={new THREE.Color('#00ff88')} transparent opacity={0.6} />
        </mesh>
      </group>
    </>
  )
}
