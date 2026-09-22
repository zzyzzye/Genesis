# 样式归属

页面和组件直接引用自己的 CSS，不再使用聚合所有页面的全局样式文件。

| 位置 | 职责 |
| --- | --- |
| `base.css` | 浏览器基础重置、根字体和页面背景，由 `main.tsx` 引入 |
| `shared.css` | 跨页面按钮、反馈、状态和无障碍工具类，由 `main.tsx` 引入 |
| `article-content.css` | 公开阅读页与 Studio 预览共用的 Markdown 排版 |
| `public-shell.css` | 公开页面的页头、页脚、导航和介绍区，由使用它的页面引入 |
| `src/pages/home/Home.css` | 首页内容 |
| `src/pages/blog/BlogPage.css` | 博客列表、筛选和阅读页布局 |
| `src/Account.css`、`src/SystemLanding.css` | 账户页和子系统入口 |
| `src/studio/StudioNavigation.css`、`StudioOverview.css`、`StudioAssistant.css` | 对应独立组件 |
| `src/studio/styles/` | Studio 页面内部的布局、登录、文章列表、编辑器、目录、设置和预览 |

## 修改规则

- 样式跟随功能归属；页面专用规则不得放进 `styles/` 的共享文件。
- 普通 CSS 使用组件前缀隔离，例如 `.studio-assistant__*`；不要新增裸 `nav`、`header` 等会影响其他页面的规则。
- 同一组件的响应式、悬停、聚焦和选中状态与其基础样式放在同一文件。
- 修改已有规则时优先编辑原声明，不要在文件末尾不断追加“最终修正”。只有确实跨页面复用的规则才提取为共享样式。
- `Studio.tsx` 先加载 MDXEditor 自带样式，再加载本项目编辑器样式；不要颠倒这一覆盖顺序。
- 当前各页面仍由路由静态导入。这次拆分明确了维护边界，不代表已经实现按路由懒加载 CSS。

本次迁移保留原有选择器、声明及媒体查询顺序；后续去重或删除旧规则，应独立验证受影响页面和交互状态。
