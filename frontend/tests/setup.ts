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
