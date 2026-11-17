import { useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { ProjectDialog } from '../src/pages/media/ProjectDialog'

it('弹窗退场立即停止交互，完成后释放模态并恢复入口焦点', async () => {
  const saved = vi.fn()
  function Workspace() {
    const [open, setOpen] = useState(false)
    return <><button onClick={() => setOpen(true)}>打开作品弹窗</button><AnimatePresence>{open && <ProjectDialog action={{ kind: 'create' }} onClose={() => setOpen(false)} onSaved={saved} />}</AnimatePresence></>
  }
  render(<Workspace />)
  const trigger = screen.getByRole('button', { name: '打开作品弹窗' })
  trigger.focus()
  fireEvent.click(trigger)
  const dialog = screen.getByRole('dialog')
  expect(screen.getByRole('textbox', { name: '作品名称' })).toHaveFocus()
  fireEvent.click(screen.getByRole('button', { name: '取消' }))
  expect(dialog).toHaveAttribute('inert')
  expect(dialog).toHaveAttribute('aria-hidden', 'true')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(saved).not.toHaveBeenCalled()
  await waitFor(() => expect(dialog).not.toBeInTheDocument())
  await waitFor(() => expect(trigger).toHaveFocus())
})
