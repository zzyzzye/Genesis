---
version: alpha
name: "Genesis"
description: "面向视频创作者的深色项目与无限画布工作区，以安静、紧凑的工具感支持连续创作。"
colors:
  canvas: "#101317"
  surface: "#1c2123"
  surface-hover: "#282f31"
  surface-active: "#30383a"
  text: "#e5eaeb"
  text-muted: "#a7b3b9"
  editor-accent: "#b7c8cf"
typography:
  sans:
    fontFamily: "Inter, PingFang SC, sans-serif"
  mono:
    fontFamily: "ui-monospace, monospace"
rounded:
  DEFAULT: "0.5rem"
  sm: "0.375rem"
  md: "0.5rem"
  lg: "0.875rem"
spacing:
  editor-control-gap: "0.25rem"
  editor-popover-padding: "0.625rem"
components:
  editor-toolbar: { }
  editor-popover: { }
  canvas-node: { }
  route-transition: { }
---

# Genesis Design System

## Overview

### Creative North Star

Genesis 的创作画布像一张深色剪辑台：内容浮在安静的底面上，工具在需要时出现、完成后退开。视觉应优先让创作者看见作品和节点关系，而不是看见控件的轮廓。

### Product context and register

- **Audience and primary job:** 视频创作者在项目内组织镜头、素材和文字节点，并在无限画布上持续编排。
- **Target market(s) and evidence:** 当前产品界面以简体中文创作流程为主；代码中的项目、素材库和画布文案均为简体中文。
- **Locale(s) and language policy:** 简体中文优先；组件为中文短标签预留稳定宽度，技术数值保留半角数字和乘号。
- **Usage scene:** 桌面端高密度创作，用户会频繁切换、添加、编辑、移动节点，工具不能遮挡画布太久。
- **Register:** 产品工具型。直接、克制、可扫读，不使用装饰性“仪表盘”语言。
- **Memorable signature:** 画布中的工具以轻量“工具模板”浮层出现：两列短动作、一个资源入口、无需厚边框分组。
- **Restraint:** 节点正文、编辑输入和画布背景保持平静；不用多层卡片、彩色描边或夸张选中框抢夺注意力。
- **Anti-references:** 不采用紫黑拼色面板、冷灰与蓝灰混搭的碎片化表面，也不采用点击后出现的双层边框、发光描边或厚重按钮盒。
- **Token ownership/runtime mapping:** 本文件镜像既有运行时样式，不生成代码。画布令牌的唯一运行时来源为 [`frontend/src/pages/media/MediaPage.css`](frontend/src/pages/media/MediaPage.css) 中的 `.media-editor` 与相关编辑器选择器；全局动效令牌的唯一来源为 [`frontend/src/lib/motion.ts`](frontend/src/lib/motion.ts)，由 [`frontend/src/App.tsx`](frontend/src/App.tsx) 的路由壳消费。视觉改动须先更新运行时代码，再同步本文件并完成浏览器自检。

## Colors

编辑器只使用中性墨黑 `canvas`、石墨色 `surface` 与低对比状态层 `surface-hover`/`surface-active`。正文采用 `text`，次级信息采用 `text-muted`，`editor-accent` 仅用于必要的主操作、连接和选中语义。画布浮层不使用紫色、蓝灰拼色或高对比边框区分层级；层级通过色阶、留白和有限阴影表达。

## Typography

界面使用 `Inter, PingFang SC, sans-serif`，保证中文与数字的阅读节奏一致；技术性辅助文本才可使用 `ui-monospace`。画布工具文字统一为 13px；随 React Flow 75% 缩放显示的节点文字使用 17.3333px 运行时补偿，目标视觉大小与工具栏一致。右侧助手采用博客助手同样的紧凑模型选择规格：供应商与容量数据 10px，当前模型和模型选项 11px，避免在窄面板中压过对话内容。中文控件不用全大写，不用无意义的超粗字重，标题和选项以常规至中等字重区分。

## Layout

画布编辑器为全屏布局，顶部项目与画幅控制、底部工具栏均是临时覆盖层。添加节点浮层锚定在底部工具栏上方，桌面宽度 272px，采用两列 40px 高动作，资源动作独占一行；窄屏时仅上移以避开换行的工具栏，不改变其紧凑信息结构。浮层打开时不得遮住其触发器，空白画布仍可作为关闭目标。

## Elevation & Depth

层级只允许画布、工具栏、浮层三层。浮层可使用柔和且低扩散的黑色阴影，不能再叠加描边或彩色外圈。节点默认不以边框包围内容；输入区与文本区没有焦点变色、阴影、描边或方形高亮。

## Shapes

小型工具浮层使用 14px 圆角，内部动作使用 8px 圆角；常规画布节点维持小圆角以服务内容边界。按钮、菜单触发器和选项默认无边框。禁用、悬停、按下通过透明度、文本色和 `surface-hover`/`surface-active` 背景表达，而不以外描边表达。

## Components

### Foundational visual states

默认状态透明或 `surface`；悬停使用 `surface-hover`；按下使用 `surface-active`；禁用仅降低可见度并保留布局。编辑器内的鼠标与键盘聚焦不显示边框、轮廓、发光或阴影，输入通过插入光标和文本选择反馈。选中节点使用一条低对比语义描边，每 2.8 秒出现一次很淡、向外散开的耀斑轮廓；耀斑只服务当前选中对象辨识，遵从“减少动态效果”设置且不形成厚光圈。

### Buttons and actions

底部“添加节点”是唯一强调动作；其余工具为无边框文字或图标动作。添加节点菜单里的六种节点以两列短标签呈现，上传/素材库保留为独立资源动作。关闭按钮始终可点击；点击浮层外部或按 Escape 必须关闭并把焦点还给触发器。

### Navigation and data display

项目菜单、画幅设置和画布工具均为临时覆盖层，不在画布中长期占用侧栏。画布节点的标题栏是统一的拖拽把手；正文编辑区、选择框、上传控件和连接点明确排除拖拽，避免编辑动作移动节点。

### Forms and overlays

输入框与文本域无默认边框和焦点装饰。非破坏性浮层允许点击外部和 Escape 关闭；其触发器使用 `aria-expanded` 与 `aria-controls` 关联。上传与素材选择保留清楚的文字标签，不只依赖图标。

### Iconography

使用 Lucide 图标，18px 用于节点菜单，16–17px 用于工具栏与节点标题。图标默认线性描边，只有视频播放符号可填充；有歧义的动作必须保留中文标签或 `aria-label`。

### Motion

全局使用 `motion` 作为唯一的组件动效入口。系统之间切换（首页、博客、工具、影音、工作台、账户）只做 200ms 的淡入和 140ms 的淡出，不使用位移或缩放，以免画布、固定层和表单产生布局错觉；同一系统内部的编辑和管理导航保持即时。局部 CSS transition 只服务已有的悬停和按下反馈。交互不使用装饰性弹跳或持续动画；选中节点的低频耀斑是唯一例外，用于表达当前操作对象而非装饰。`MotionConfig` 遵从系统“减少动态效果”，同时全局 CSS 关闭平滑滚动和局部过渡。

### Content and data visualization

文案采用简洁的动作词，如“添加节点”“上传或从素材库选择”“适应全部”。比例、时长和分辨率使用数字与标准符号；节点标题必须允许截断，不破坏画布布局。

## Do's and Don'ts

- **Do:** 将画布内容、节点关系和创作输入置于工具容器之上。
- **Do:** 让所有节点通过一致的标题栏拖拽，同时保留正文的直接编辑能力。
- **Don't:** 使用紫黑、蓝灰等不同色系拼接的深色面板，或用彩色描边定义层级。
- **Don't:** 为点击、聚焦或选中添加厚边框、双层外圈、发光阴影或“盒子套盒子”式容器。
