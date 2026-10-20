import { useEffect, useRef } from 'react'
import { MousePointer2 } from 'lucide-react'
import { isArrowSkin, skinImage } from './arrowSkinAssets'
import { drawFantasyCursor, isFantasyTheme } from './fantasy'
import { drawTrail, type TrailPoint } from './trailDrawing'
import type { CursorTheme, CursorTrailStyle } from './preferences'

export function CursorSample({ theme = 'system', trail }: { theme?: CursorTheme; trail?: CursorTrailStyle }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const surface = canvas.current
    if (!surface || typeof CanvasRenderingContext2D === 'undefined') return
    const ctx = surface.getContext('2d')
    if (!ctx) return
    ctx.setTransform(2, 0, 0, 2, 0, 0)
    const parent = surface.parentElement!
    const reduced = matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0, start = 0
    function paint(progress = 0) {
      ctx!.clearRect(0, 0, 200, 112)
      const x = progress ? 100 + Math.sin(progress * Math.PI * 2) * 32 : 112
      const y = progress ? 58 + Math.cos(progress * Math.PI * 2) * 12 : 56
      const now = 1000
      const points: TrailPoint[] = Array.from({ length: 18 }, (_, i) => ({ x: x - 62 + i * 3.4, y: y + Math.sin(i * .25) * 12, born: now - (18 - i) * 26 }))
      if (trail) { drawTrail(ctx!, trail, points, now); return }
      ctx!.fillStyle = '#303038'; ctx!.strokeStyle = '#303038'; ctx!.lineWidth = 1
      if (isFantasyTheme(theme)) {
        drawFantasyCursor(ctx!, theme, { x, y, time: now, speed: 8, hovering: false, pressed: false, reduced: reduced.matches, pulse: 0, pulseX: x, pulseY: y, samples: points, body: Array.from({length:16},(_,i)=>({x:x-i*3.4,y:y+Math.sin(i*.45)*8})) })
      } else if (theme === 'gooey') {
        points.slice(-6).forEach((p,i)=>{ctx!.globalAlpha=.12+i*.12;ctx!.beginPath();ctx!.arc(p.x,p.y,3+i,0,Math.PI*2);ctx!.fill()});ctx!.globalAlpha=1
        ctx!.beginPath();ctx!.arc(x,y,9,0,Math.PI*2);ctx!.fill()
      } else if (theme === 'crayon') {
        ctx!.save();ctx!.translate(x,y);ctx!.rotate(-.5);ctx!.fillRect(-2,-15,4,14);ctx!.beginPath();ctx!.moveTo(-2,-1);ctx!.lineTo(2,-1);ctx!.lineTo(0,3);ctx!.fill();ctx!.restore()
        ctx!.globalAlpha=.25;ctx!.beginPath();points.forEach((p,i)=>{if(i)ctx!.lineTo(p.x,p.y);else ctx!.moveTo(p.x,p.y)});ctx!.stroke();ctx!.globalAlpha=1
      } else if (theme === 'emitter') {
        for(let i=0;i<6;i++){ctx!.globalAlpha=.1+i*.08;ctx!.beginPath();ctx!.ellipse(x-i*8,y,5+i*3,5+i*2,0,0,Math.PI*2);ctx!.stroke()}ctx!.globalAlpha=1
        ctx!.beginPath();ctx!.arc(x,y,2.5,0,Math.PI*2);ctx!.fill()
      } else if (theme === 'lens') {
        const gradient=ctx!.createLinearGradient(x-18,y-18,x+18,y+18);gradient.addColorStop(0,'#c9cbd2');gradient.addColorStop(1,'#e6e7eb');ctx!.fillStyle=gradient
        ctx!.beginPath();ctx!.roundRect(x-18,y-18,36,36,9);ctx!.fill();ctx!.fillStyle='#303038';ctx!.beginPath();ctx!.arc(x,y,2,0,Math.PI*2);ctx!.fill()
      } else if(theme === 'follower') {ctx!.beginPath();ctx!.ellipse(x,y,17,12,-.35,0,Math.PI*2);ctx!.fill()}
    }
    function animate(now: number) {
      const progress=(now-start)/1000
      if(progress>=1){frame=0;paint();return}
      paint(progress);frame=requestAnimationFrame(animate)
    }
    function play(){if(reduced.matches)return;cancelAnimationFrame(frame);start=performance.now();frame=requestAnimationFrame(animate)}
    function stop(){cancelAnimationFrame(frame);frame=0;paint()}
    paint();parent.addEventListener('pointerenter',play);parent.addEventListener('pointerleave',stop);reduced.addEventListener('change',stop)
    return()=>{cancelAnimationFrame(frame);parent.removeEventListener('pointerenter',play);parent.removeEventListener('pointerleave',stop);reduced.removeEventListener('change',stop)}
  },[theme,trail])
  if (!trail && isArrowSkin(theme)) return <img src={skinImage(theme)} alt="" />
  if (!trail && theme === 'system') return <MousePointer2 />
  if (trail === 'none') return <MousePointer2 />
  return <canvas ref={canvas} width={400} height={224} style={{ width: '100%', height: '100%' }} />
}
