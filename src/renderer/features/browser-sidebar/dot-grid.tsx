/**
 * DotGrid Background Component
 * An interactive dot grid background with mouse proximity and shock effects
 * Easter egg for device emulation mode
 */

import { useRef, useEffect, useCallback } from "react"

interface DotGridProps {
  /** Size of each dot in pixels */
  dotSize?: number
  /** Gap between dots in pixels */
  gap?: number
  /** Proximity radius for color activation in pixels */
  proximity?: number
  /** Shock radius - dots within this range get pushed away */
  shockRadius?: number
  /** Shock strength - how far dots get pushed */
  shockStrength?: number
  /** Resistance - how quickly dots return (higher = slower) */
  resistance?: number
  /** Return duration in seconds */
  returnDuration?: number
  /** Additional className */
  className?: string
}

interface Dot {
  x: number
  y: number
  baseX: number
  baseY: number
  vx: number
  vy: number
}

export function DotGrid({
  dotSize = 3,
  gap = 18,
  proximity = 120,
  shockRadius = 80,
  shockStrength = 8,
  resistance = 0.92,
  returnDuration = 0.8,
  className = "",
}: DotGridProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mouseRef = useRef({ x: -1000, y: -1000, isMoving: false })
  const prevMouseRef = useRef({ x: -1000, y: -1000 })
  const animationRef = useRef<number>()
  const dotsRef = useRef<Dot[]>([])
  const colorsRef = useRef<{ base: string; active: string }>({ base: "", active: "" })

  // Get theme colors from CSS variables
  const updateColors = useCallback(() => {
    const root = document.documentElement
    const style = getComputedStyle(root)

    // Get primary color HSL values - format is "H S% L%" (space-separated)
    const primaryHsl = style.getPropertyValue("--primary").trim()

    if (primaryHsl) {
      // Primary is in format "152 100% 39%" - need to use hsl() with space-separated values
      colorsRef.current = {
        base: `hsl(${primaryHsl} / 0.18)`,
        active: `hsl(${primaryHsl} / 0.75)`,
      }
    } else {
      // Fallback colors (green theme)
      colorsRef.current = {
        base: "rgba(0, 200, 83, 0.18)",
        active: "rgba(0, 200, 83, 0.75)",
      }
    }
  }, [])

  // Initialize dots grid
  const initDots = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const { width, height } = canvas
    const dots: Dot[] = []
    const spacing = dotSize + gap

    for (let x = spacing / 2; x < width; x += spacing) {
      for (let y = spacing / 2; y < height; y += spacing) {
        dots.push({ x, y, baseX: x, baseY: y, vx: 0, vy: 0 })
      }
    }

    dotsRef.current = dots
    updateColors()
  }, [dotSize, gap, updateColors])

  // Animation loop
  const animate = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const { width, height } = canvas
    ctx.clearRect(0, 0, width, height)

    const mouse = mouseRef.current
    const prevMouse = prevMouseRef.current

    // Calculate mouse velocity for shock detection
    const mouseDx = mouse.x - prevMouse.x
    const mouseDy = mouse.y - prevMouse.y
    const mouseSpeed = Math.sqrt(mouseDx * mouseDx + mouseDy * mouseDy)
    const isShocking = mouseSpeed > 2

    // Spring constant for return animation
    const springK = 1 / (returnDuration * 60) // Assuming 60fps

    dotsRef.current.forEach((dot) => {
      const dx = mouse.x - dot.x
      const dy = mouse.y - dot.y
      const distance = Math.sqrt(dx * dx + dy * dy)

      // Shock effect - push dots away from fast mouse movement
      if (isShocking && distance < shockRadius && distance > 0) {
        const angle = Math.atan2(dot.y - mouse.y, dot.x - mouse.x)
        const force = (1 - distance / shockRadius) * shockStrength * (mouseSpeed / 10)
        dot.vx += Math.cos(angle) * force
        dot.vy += Math.sin(angle) * force
      }

      // Apply velocity with resistance
      dot.x += dot.vx
      dot.y += dot.vy
      dot.vx *= resistance
      dot.vy *= resistance

      // Spring back to base position
      const returnDx = dot.baseX - dot.x
      const returnDy = dot.baseY - dot.y
      dot.vx += returnDx * springK
      dot.vy += returnDy * springK

      // Color based on distance to mouse
      const colorDistance = Math.sqrt(
        Math.pow(mouse.x - dot.x, 2) + Math.pow(mouse.y - dot.y, 2)
      )
      const t = Math.max(0, 1 - colorDistance / proximity)

      // Draw dot
      ctx.beginPath()
      ctx.arc(dot.x, dot.y, dotSize / 2 + t * 1.5, 0, Math.PI * 2)

      // Interpolate between base and active color
      if (t > 0.01) {
        ctx.fillStyle = colorsRef.current.active
        ctx.globalAlpha = 0.15 + t * 0.55
      } else {
        ctx.fillStyle = colorsRef.current.base
        ctx.globalAlpha = 1
      }

      ctx.fill()
      ctx.globalAlpha = 1
    })

    // Update previous mouse position
    prevMouseRef.current = { x: mouse.x, y: mouse.y }

    animationRef.current = requestAnimationFrame(animate)
  }, [dotSize, proximity, shockRadius, shockStrength, resistance, returnDuration])

  // Handle resize
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const parent = canvas.parentElement
    if (!parent) return

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (width > 0 && height > 0) {
          canvas.width = width
          canvas.height = height
          initDots()
        }
      }
    })

    resizeObserver.observe(parent)

    return () => resizeObserver.disconnect()
  }, [initDots])

  // Handle mouse events
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      mouseRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        isMoving: true,
      }
    }

    const handleMouseLeave = () => {
      mouseRef.current = { x: -1000, y: -1000, isMoving: false }
    }

    // Listen on parent to catch events even when canvas doesn't fill area
    const parent = canvas.parentElement
    if (parent) {
      parent.addEventListener("mousemove", handleMouseMove)
      parent.addEventListener("mouseleave", handleMouseLeave)

      return () => {
        parent.removeEventListener("mousemove", handleMouseMove)
        parent.removeEventListener("mouseleave", handleMouseLeave)
      }
    }
  }, [])

  // Start animation loop
  useEffect(() => {
    animationRef.current = requestAnimationFrame(animate)
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [animate])

  // Update colors when theme changes
  useEffect(() => {
    const observer = new MutationObserver(() => {
      updateColors()
    })

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    })

    return () => observer.disconnect()
  }, [updateColors])

  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 pointer-events-none ${className}`}
      style={{ width: "100%", height: "100%" }}
    />
  )
}
