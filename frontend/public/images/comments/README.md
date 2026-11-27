# 评论图片表情

素材来自 [Microsoft Fluent Emoji](https://github.com/microsoft/fluentui-emoji)，采用原始 3D PNG，按同目录 `LICENSE` 的 MIT 许可分发。

- 固定来源版本：`1ffb34c752ecf5d402f04cfb4b392c77f57c54bc`。
- 上游路径：`assets/<英文名称>/3D/<英文名称小写并以 _ 替换空格>_3d.png`。
- 图片以本地文件加载，不依赖第三方 CDN，不上传读者输入。
- 短码、中文名称与本地路径由 `frontend/src/features/blog/commentStickers.ts` 维护。短码属于已存储评论的格式，后续扩展须保持兼容。
- 公开评论、引用、后台审核及回复通知统一通过 `CommentContent` 渲染，未知短码与加载失败均保留可读文字。

| 本地文件 | 上游英文名称 |
| --- | --- |
| smile.png | Grinning face |
| grin.png | Beaming face with smiling eyes |
| joy.png | Face with tears of joy |
| rofl.png | Rolling on the floor laughing |
| love.png | Smiling face with hearts |
| heart-eyes.png | Smiling face with heart-eyes |
| kiss.png | Face blowing a kiss |
| wink.png | Winking face |
| cool.png | Smiling face with sunglasses |
| think.png | Thinking face |
| skeptical.png | Face with raised eyebrow |
| neutral.png | Neutral face |
| unamused.png | Unamused face |
| eye-roll.png | Face with rolling eyes |
| surprise.png | Face with open mouth |
| blush.png | Flushed face |
| plead.png | Pleading face |
| cry.png | Crying face |
| sob.png | Loudly crying face |
| angry.png | Angry face |
| mind-blown.png | Exploding head |
| celebrate.png | Party popper |
| heart.png | Red heart |
| fire.png | Fire |
