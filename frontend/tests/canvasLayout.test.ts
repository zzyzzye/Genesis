import { expect, it } from 'vitest'
import { arrangeCanvas } from '../src/pages/media/canvasLayout'
import { emptyDocument, type Document, type Node } from '../src/pages/media/api'

const node = (id: string, type: Node['type'], x = 0, y = 0): Node => ({ id, type, asset_id: null, name: id, text: '保留提示词', x, y, width: type === 'video' ? 640 : 360, height: type === 'video' ? 402 : 203 })
const linked = (nodes: Node[], pairs: [string, string][]): Document => ({ ...emptyDocument(), nodes, edges: pairs.map(([source, target], index) => ({ id: `edge-${index}`, source, target })) })

it('把多路参考放在生成节点左侧、成品放右侧，保留尺寸、内容及连线顺序', () => {
  const doc = linked([node('video', 'video', -700, 150), node('ref-2', 'image', 900, 600), node('result', 'video_asset', -900, 0), node('ref-1', 'image', 900, 0)], [['ref-1', 'video'], ['ref-2', 'video'], ['video', 'result']])
  const original = structuredClone(doc)
  const result = arrangeCanvas(doc)
  const byId = new Map(result.nodes.map(item => [item.id, item]))
  for (const edge of result.edges) expect(byId.get(edge.source)!.x + byId.get(edge.source)!.width).toBeLessThan(byId.get(edge.target)!.x)
  expect(byId.get('ref-1')!.y).toBeLessThan(byId.get('ref-2')!.y)
  expect(result.edges).toBe(doc.edges)
  expect(result.nodes.map(item => ({ ...item, x: 0, y: 0 }))).toEqual(doc.nodes.map(item => ({ ...item, x: 0, y: 0 })))
  expect(doc).toEqual(original)
  for (const a of result.nodes) for (const b of result.nodes) {
    if (a.id === b.id) continue
    expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true)
  }
  expect(arrangeCanvas(result)).toEqual(result)
})

it('分组整体移动，内部相对位置和分组尺寸保持，成员的外部连线参与排版', () => {
  const group = { ...node('group', 'group', 10, 20), width: 800, height: 700, member_ids: ['a', 'b'] }
  const doc = linked([group, node('a', 'image_generation', 40, 80), node('b', 'image', 420, 360), node('output', 'video', -700, 0)], [['a', 'b'], ['b', 'output']])
  const result = arrangeCanvas(doc)
  const moved = result.nodes[0]!
  for (let index = 1; index < 3; index++) {
    expect(result.nodes[index]!.x - moved.x).toBe(doc.nodes[index]!.x - group.x)
    expect(result.nodes[index]!.y - moved.y).toBe(doc.nodes[index]!.y - group.y)
  }
  expect(moved.width).toBe(group.width)
  expect(moved.member_ids).toEqual(group.member_ids)
  expect(moved.x + moved.width).toBeLessThan(result.nodes[3]!.x)
})

it('为当前展开的编辑区留空，未连线内容仍可排版', () => {
  const doc = linked([node('editing', 'video'), node('other', 'note', 0, 800)], [])
  const result = arrangeCanvas(doc, { id: 'editing', height: 360 })
  const a = result.nodes[0]!, b = result.nodes[1]!
  expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height + 374 <= b.y || b.y + b.height <= a.y).toBe(true)
})

it('环路、重复连线、自连和悬空连线不会损坏数据或产生无效坐标', () => {
  const doc = linked([node('a', 'image'), node('b', 'video'), node('standalone', 'text')], [['a', 'b'], ['b', 'a'], ['a', 'a'], ['a', 'b'], ['missing', 'b']])
  const result = arrangeCanvas(doc)
  expect(result.edges).toBe(doc.edges)
  expect(result.nodes).toHaveLength(3)
  expect(result.nodes.every(item => Number.isFinite(item.x) && Number.isFinite(item.y))).toBe(true)
})

it('多个目标的参考顺序相反时仍可排版，不改各自引用顺序', () => {
  const doc = linked([node('a', 'image'), node('b', 'image'), node('one', 'video'), node('two', 'video')], [['a', 'one'], ['b', 'one'], ['b', 'two'], ['a', 'two']])
  const result = arrangeCanvas(doc)
  expect(result.edges).toBe(doc.edges)
  expect(result.nodes.every(item => Number.isFinite(item.x) && Number.isFinite(item.y))).toBe(true)
})

it('空画布保持原对象', () => {
  const doc = emptyDocument()
  expect(arrangeCanvas(doc)).toBe(doc)
})
