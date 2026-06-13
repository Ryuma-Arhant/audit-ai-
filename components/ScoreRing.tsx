const RADIUS = 54
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

function scoreColor(score: number): string {
  if (score >= 80) return '#16a34a'
  if (score >= 60) return '#ca8a04'
  if (score >= 40) return '#ea580c'
  return '#dc2626'
}

interface ScoreRingProps {
  trustScore: number
  reliabilityScore: number | null
  uxScore: number | null
  costUsd: number | null
  durationMs: number | null
}

export function ScoreRing({ trustScore, reliabilityScore, uxScore, costUsd, durationMs }: ScoreRingProps) {
  const color = scoreColor(trustScore)
  const offset = CIRCUMFERENCE * (1 - trustScore / 100)

  return (
    <div className="py-8 text-center bg-white border rounded-xl mb-8">
      <svg width="140" height="140" viewBox="0 0 140 140" className="mx-auto">
        {/* Track */}
        <circle
          cx="70" cy="70" r={RADIUS}
          fill="none"
          stroke="#e5e7eb"
          strokeWidth="10"
        />
        {/* Progress */}
        <circle
          cx="70" cy="70" r={RADIUS}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          transform="rotate(-90 70 70)"
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
        {/* Score number */}
        <text
          x="70" y="66"
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="32"
          fontWeight="bold"
          fill={color}
        >
          {trustScore}
        </text>
        {/* Label */}
        <text
          x="70" y="88"
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="10"
          fill="#9ca3af"
          letterSpacing="0.05em"
        >
          TRUST SCORE
        </text>
      </svg>

      <div className="mt-2 flex justify-center gap-4 text-xs text-gray-400 flex-wrap px-4">
        <span>Reliability <strong className="text-gray-600">{reliabilityScore ?? '—'}</strong></span>
        <span>UX <strong className="text-gray-600">{uxScore ?? '—'}</strong></span>
        {costUsd    !== null && <span>${costUsd.toFixed(4)}</span>}
        {durationMs !== null && <span>{(durationMs / 1000).toFixed(1)}s</span>}
      </div>
    </div>
  )
}
