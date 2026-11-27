/** 短码是评论存储格式；只解析此目录内的本地图片，未知短码保留原文。 */
export const commentStickers = ([
  ['smile', '开心'], ['grin', '大笑'], ['joy', '笑哭'], ['rofl', '笑翻'],
  ['love', '幸福'], ['heart-eyes', '喜欢'], ['kiss', '飞吻'], ['wink', '眨眼'],
  ['cool', '酷'], ['think', '思考'], ['skeptical', '疑问'], ['neutral', '无语'],
  ['unamused', '不开心'], ['eye-roll', '白眼'], ['surprise', '惊讶'], ['blush', '脸红'],
  ['plead', '委屈'], ['cry', '流泪'], ['sob', '大哭'], ['angry', '生气'],
  ['mind-blown', '震惊'], ['celebrate', '庆祝'], ['heart', '爱心'], ['fire', '火热'],
] as const).map(([id, label]) => ({ id, label, code: `[表情:${label}]`, src: `/images/comments/${id}.png` }))

export type CommentSticker = typeof commentStickers[number]
export const commentStickerByCode = new Map(commentStickers.map(sticker => [sticker.code, sticker]))
