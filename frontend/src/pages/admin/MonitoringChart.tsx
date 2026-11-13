import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { EChartsType } from 'echarts/core'
import { ChartNoAxesCombined, RefreshCw } from 'lucide-react'
import type { Point } from './api'

export function MonitoringChart({points,name,unit,start,end,detail=false,comparison}:{points:Point[];name:string;unit:string;start:number;end:number;detail?:boolean;comparison?:{name:string;points:Point[]}}) {
  const root=useRef<HTMLDivElement>(null)
  const chart=useRef<EChartsType|null>(null)
  const renderer=useRef<typeof import('./monitoringChartOptions')|null>(null)
  const [ready,setReady]=useState(false)
  const [failed,setFailed]=useState(false)
  const [attempt,setAttempt]=useState(0)
  const selected=useRef(-1)
  const [announcement,setAnnouncement]=useState('')
  const count=points.filter(point=>point[1]!=null).length+(comparison?.points.filter(point=>point[1]!=null).length??0)
  const draw=useEffectEvent(()=>{
    if(!root.current?.clientWidth||!renderer.current)return
    if(!chart.current)chart.current=renderer.current.createMonitoringChart(root.current)
    chart.current.setOption(renderer.current.monitoringOption(points,name,unit,start,end,getComputedStyle(root.current),detail,comparison),{notMerge:true})
    setReady(true)
  })
  useEffect(()=>{
    const element=root.current
    if(!element||typeof CanvasRenderingContext2D==='undefined')return
    let cancelled=false
    const observer=new ResizeObserver(()=>{chart.current?.resize();draw()})
    observer.observe(element)
    void import('./monitoringChartOptions').then(module=>{
      if(cancelled)return
      renderer.current=module;setFailed(false);draw()
    }).catch(()=>{if(!cancelled)setFailed(true)})
    return ()=>{cancelled=true;observer.disconnect();chart.current?.dispose();chart.current=null;renderer.current=null}
  },[attempt])
  useEffect(()=>{draw()},[points,name,unit,start,end,detail,comparison])
  const time=(value:number)=>new Date(value*1000).toLocaleString('zh-CN',end-start>86400?{month:'2-digit',day:'2-digit'}:{hour:'2-digit',minute:'2-digit',hour12:false})
  return <div className={`admin-history${detail?' admin-history--detail':''}`}>
    <div ref={root} className="admin-history-chart" role="img" tabIndex={count>1&&ready?0:undefined} aria-label={`${comparison?`${name}与${comparison.name}`:name}趋势，${count} 个有效样本；左右方向键查看数值，Escape 关闭提示`} onKeyDown={event=>{
      if(event.key==='Escape'){chart.current?.dispatchAction({type:'hideTip'});return}
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)||!renderer.current)return
      event.preventDefault()
      const secondary=!points.some(p=>p[1]!=null)&&comparison
      const rows=renderer.current.historyPoints(secondary?secondary.points:points,start,end)
      selected.current=event.key==='Home'?0:event.key==='End'?rows.length-1:Math.max(0,Math.min(rows.length-1,selected.current+(event.key==='ArrowLeft'?-1:1)))
      const point=rows[selected.current]
      if(!point)return
      chart.current?.dispatchAction({type:'showTip',seriesIndex:secondary?1:0,dataIndex:selected.current})
      const compared=comparison?.points.find(row=>row[0]*1000===point[0])
      setAnnouncement(`${new Date(point[0]).toLocaleString('zh-CN')}，${secondary?secondary.name:name} ${renderer.current.metricValue(point[1],unit)}${comparison&&!secondary?`，${comparison.name} ${renderer.current.metricValue(compared?.[1],unit)}`:''}`)
    }} onBlur={()=>chart.current?.dispatchAction({type:'hideTip'})}/>
    {(count<2||!ready||failed)&&<div className="admin-history-placeholder"><ChartNoAxesCombined size={18} aria-hidden="true"/><span>{count===0?'暂无样本':count===1?'样本积累中':failed?'图表加载失败':'正在绘制'}</span>{failed&&<button aria-label={`重试${name}图表`} onClick={()=>setAttempt(n=>n+1)}><RefreshCw size={14}/></button>}</div>}
    {!detail&&<div className="admin-history-time" aria-hidden="true"><span>{time(start)}</span><span>{time(end)}</span></div>}<span className="sr-only" aria-live="polite">{announcement}</span>
  </div>
}
