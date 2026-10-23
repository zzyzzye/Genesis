import type { IconKey } from '@mdxeditor/editor'
import {
  AlignCenter, AlignLeft, AlignRight, ArrowDownToLine, ArrowLeftToLine,
  ArrowRightToLine, ArrowUpRight, ArrowUpToLine, Bold, Check, ChevronDown,
  Code, Columns2, Columns3, Copy, Ellipsis, EllipsisVertical, FileCode2,
  FileJson, FileText, Highlighter, ImagePlus, Italic, Link2, List, ListChecks,
  ListOrdered, MessageSquareWarning, Minus, Pencil, Redo2, Rows3, Settings,
  SquareCode, Strikethrough, Subscript, Superscript, Table2, Trash, Trash2,
  Underline, Undo2, Unlink2, X, type LucideIcon,
} from 'lucide-react'

// 通过编辑器原生扩展点统一图标，不替换工具行为或键盘模型。
const editorIcons: Record<IconKey, LucideIcon> = {
  undo: Undo2, redo: Redo2, format_bold: Bold, format_italic: Italic,
  format_underlined: Underline, code: Code, strikeThrough: Strikethrough,
  superscript: Superscript, subscript: Subscript, format_list_bulleted: List,
  format_list_numbered: ListOrdered, format_list_checked: ListChecks,
  format_highlight: Highlighter, link: Link2, add_photo: ImagePlus, table: Table2,
  horizontal_rule: Minus, frontmatter: FileJson, frame_source: SquareCode,
  arrow_drop_down: ChevronDown, admonition: MessageSquareWarning,
  rich_text: FileText, difference: Columns2, markdown: FileCode2,
  open_in_new: ArrowUpRight, link_off: Unlink2, edit: Pencil, content_copy: Copy,
  more_horiz: Ellipsis, more_vert: EllipsisVertical, close: X, settings: Settings,
  delete_big: Trash2, delete_small: Trash, format_align_center: AlignCenter,
  format_align_left: AlignLeft, format_align_right: AlignRight,
  add_row: Rows3, add_column: Columns3, insert_col_left: ArrowLeftToLine,
  insert_row_above: ArrowUpToLine, insert_row_below: ArrowDownToLine,
  insert_col_right: ArrowRightToLine, check: Check,
}

export function editorIcon(name: IconKey) {
  const Icon = editorIcons[name]
  return <Icon size={18} strokeWidth={1.75} aria-hidden="true" focusable="false" />
}
