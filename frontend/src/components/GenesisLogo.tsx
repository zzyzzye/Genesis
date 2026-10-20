import './GenesisLogo.css'

interface GenesisLogoProps {
  label?: string
  markOnly?: boolean
  inverse?: boolean
}

/** 品牌几何标记共用一个 SVG，深色区域只反转颜色，不改变轮廓。 */
export function GenesisLogo({ label = 'Genesis', markOnly = false, inverse = false }: GenesisLogoProps) {
  return <span className={`genesis-logo${inverse ? ' genesis-logo--inverse' : ''}`} role="img" aria-label={label}>
    <img className="genesis-logo-symbol" src="/brand/genesis-symbol.svg" width={32} height={32} alt="" aria-hidden="true" />
    {!markOnly && <span className="genesis-logo-wordmark" aria-hidden="true">{label}</span>}
  </span>
}
