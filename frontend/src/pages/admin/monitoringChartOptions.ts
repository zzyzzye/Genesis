import { init, use as registerECharts } from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'
import type { EChartsOption } from 'echarts'
import { metricLabel as metricValue, type Point } from './api'
export { metricValue }

registerECharts([LineChart, GridComponent, TooltipComponent, SVGRenderer])

export function createMonitoringChart(element: HTMLDivElement) {
  return init(element, undefined, { renderer: 'svg' })
}

export function historyPoints(points:Point[],start:number,end:number):Point[] {
  const step=(end-start)/120
  const result:Point[]=[]
  points.forEach((point,index)=>{
    const previous=points[index-1]
    // 保留停采区间，不用直线连接中断前后的样本。
    if(previous && point[0]-previous[0]>step*1.5)result.push([(previous[0]+step)*1000,null])
    result.push([point[0]*1000,point[1]])
  })
  return result
}

export function monitoringOption(points:Point[],name:string,unit:string,start:number,end:number,style:CSSStyleDeclaration,detail=false,comparison?:{name:string;points:Point[]}):EChartsOption {
  const ink=style.getPropertyValue('--account-ink').trim()||'#151515'
  const muted=style.getPropertyValue('--account-muted').trim()||'#686868'
  const paper=style.getPropertyValue('--account-paper').trim()||'#fff'
  return {
    animation:false,
    grid:detail?{left:64,right:8,top:12,bottom:28}:{left:2,right:2,top:10,bottom:4},
    xAxis:{type:'time',min:start*1000,max:end*1000,show:detail,splitNumber:4,axisLine:{show:false},axisTick:{show:false},axisLabel:{color:muted,fontSize:10,hideOverlap:true,formatter:(value:number)=>new Date(value).toLocaleString('zh-CN',end-start>86400?{month:'2-digit',day:'2-digit'}:{hour:'2-digit',minute:'2-digit',hour12:false})}},
    yAxis:{type:'value',min:0,max:unit==='%'?Math.max(100,...points.map(p=>p[1]??0)):undefined,show:detail,splitNumber:3,axisLabel:{color:muted,fontSize:10,formatter:(value:number)=>metricValue(value,unit)},splitLine:{lineStyle:{color:style.getPropertyValue('--account-soft').trim()||'#f4f4f4',type:'dashed'}}},
    tooltip:{trigger:'axis',confine:true,borderWidth:0,backgroundColor:paper,textStyle:{color:ink,fontSize:11},padding:8,
      extraCssText:'box-shadow:none;max-width:100%;white-space:normal;',
      axisPointer:{type:'line',lineStyle:{color:muted,width:1,type:'dashed'}},
      formatter:params=>{
        const item=Array.isArray(params)?params[0]:params
        const value=item?.value as Point|undefined
        const content=document.createElement('div')
        content.textContent=value?new Date(value[0]).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):''
        for(const row of Array.isArray(params)?params:[params]){
          const line=document.createElement('div')
          line.textContent=`${row.seriesName} ${metricValue((row.value as Point)?.[1],unit)}`
          content.append(line)
        }
        return content
      }},
    series:[{name,type:'line',data:historyPoints(points,start,end),connectNulls:false,showSymbol:false,symbolSize:5,smooth:false,
      lineStyle:{width:1.8,color:ink},itemStyle:{color:ink},areaStyle:{color:ink,opacity:detail ? .025 : .055},emphasis:{disabled:true}},
      ...(comparison?[{name:comparison.name,type:'line' as const,data:historyPoints(comparison.points,start,end),connectNulls:false,showSymbol:false,symbolSize:5,smooth:false,lineStyle:{width:1.8,color:muted,type:'dashed' as const},itemStyle:{color:muted},emphasis:{disabled:true}}]:[])],
  }
}
