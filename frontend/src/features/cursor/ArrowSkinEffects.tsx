import { useEffect } from 'react'
import { skinStyles, type ArrowSkin } from './arrowSkinAssets'

export function ArrowSkinEffects({ skin }: { skin: ArrowSkin }) {
  useEffect(() => {
    document.documentElement.dataset.genesisSkin = skin
    return () => { document.documentElement.removeAttribute('data-genesis-skin') }
  }, [skin])
  return <style>{skinStyles(skin)}</style>
}
