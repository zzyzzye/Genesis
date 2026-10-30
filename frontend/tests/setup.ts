import '@testing-library/jest-dom/vitest'

class TestResizeObserver implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (!globalThis.ResizeObserver) globalThis.ResizeObserver = TestResizeObserver

// jsdom 不实现模态顶层与滚动，真实行为通过浏览器验证。
HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
Element.prototype.scrollIntoView = function () {}
// jsdom 没有文字布局；CodeMirror 的真实位置、光标和候选菜单在浏览器验收。
if (!('getClientRects' in Range.prototype)) Object.defineProperty(Range.prototype, 'getClientRects', { value: () => [], configurable: true })
if (!('getBoundingClientRect' in Range.prototype)) Object.defineProperty(Range.prototype, 'getBoundingClientRect', { value: () => new DOMRect(), configurable: true })
