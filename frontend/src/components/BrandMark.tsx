/**
 * The brand mark: a slowly rotating 3D block.
 *
 * A blockchain record is a *block* in a chain, so the mark is literally that —
 * six faces on a `transform-style: preserve-3d` parent, rotated by a single
 * CSS keyframe. No three.js, no canvas, no WebGL context: it costs one
 * composited animation, works with JavaScript disabled, and can't fail to load.
 *
 * The motion is deliberately slow (20s per revolution). This sits beside a
 * trust claim, and anything faster reads as decoration rather than assurance.
 * Under `prefers-reduced-motion` the animation stops on the tilted pose, so it
 * stays a legible cube rather than collapsing to a flat square (see index.css).
 *
 * Isolated on purpose — the whole mark is swappable from this one file.
 */
export function BrandMark({ size = 56 }: { size?: number }) {
  // Faces are ordered to match the nth-child transforms in index.css:
  // front, back, right, left, top, bottom.
  const faces = [
    'bg-white/25',
    'bg-white/10',
    'bg-white/20',
    'bg-white/[0.07]',
    'bg-white/30',
    'bg-white/[0.05]',
  ]

  return (
    <span
      className="cube-scene inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <span
        className="cube"
        style={{ '--cube-size': `${size * 0.62}px` } as React.CSSProperties}
      >
        {faces.map((tint, i) => (
          <span
            key={i}
            className={`cube-face rounded-[3px] border border-white/40 ${tint}`}
          />
        ))}
      </span>
    </span>
  )
}
