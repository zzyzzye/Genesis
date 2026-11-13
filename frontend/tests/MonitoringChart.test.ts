import { expect, it } from 'vitest'
import { historyPoints, monitoringOption } from '../src/pages/admin/monitoringChartOptions'

it('保留真实零值，跨采集空档插入断点，缺失样本不变成零',()=>{
  expect(historyPoints([[0,0],[30,null],[300,40]],0,3600)).toEqual([[0,0],[30000,null],[60000,null],[300000,40]])
})

it('时间范围固定，百分比上限保留多核占用，图表不连接缺失区间',()=>{
  const option=monitoringOption([[3300,20],[3600,180]],'CPU','%',0,3600,getComputedStyle(document.body))
  expect(option).toMatchObject({animation:false,xAxis:{min:0,max:3600000},yAxis:{max:180},series:[{type:'line',connectNulls:false}]})
})
