export function RatioOptions({ ratios, value, label, onChange }: {
  ratios: readonly string[]; value: string; label: string; onChange: (ratio: string) => void
}) {
  return <div className="media-image-options media-image-ratios">{ratios.map(ratio => {
    const [w = 1, h = 1] = ratio.split(':').map(Number)
    const width = 18 * w / Math.max(w, h), height = 18 * h / Math.max(w, h)
    return <button type="button" key={ratio} aria-label={`${label} ${ratio}`} aria-pressed={value === ratio} onClick={() => onChange(ratio)}>
      <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><rect x={(24 - width) / 2} y={(24 - height) / 2} width={width} height={height} rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
      <span>{ratio}</span>
    </button>
  })}</div>
}
