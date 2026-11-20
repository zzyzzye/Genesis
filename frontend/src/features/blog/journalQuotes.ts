const originalQuotes = [
  '把片刻的发现，写成日后的回声。',
  '世界很大，先认真看见眼前的一小部分。',
  '有些答案，藏在慢下来之后。',
  '让好奇心带路，让文字留下足迹。',
  '走过的路，读过的字，都会在某一天相遇。',
  '把生活写成文字，留住看世界的方式。',
  '在熟悉的日常里，寻找尚未发现的风景。',
  '不急着抵达，也是一种前进。',
  '把问题留给思考，把发现留在这里。',
  '微小的进步，也值得被认真记下。',
  '读一段文字，为生活打开另一扇窗。',
  '好的想法，常常从一个朴素的问题开始。',
  '为平凡的日子，留一页空白。',
  '山海各有回声，文字自有来处。',
  '在一页书里，遇见辽阔的远方。',
  '风经过山谷，思绪经过纸页。',
  '把今天的好奇，交给明天的自己。',
  '走进一段文字，听见另一种生活。',
  '留一点时间，给没有目的的阅读。',
  '每一个认真观察的瞬间，都有值得记下的光。',
  '从细小的事物里，读出世界的宽广。',
  '带着问题出发，沿着发现前行。',
  '远方有山海，眼前有值得书写的日常。',
  '让文字慢一点，让心走远一点。',
] as const

export interface JournalQuote {
  id: string
  text: string
  author: string
  work?: string
  source?: string
}

function poem(id: string, text: string, author: string, work: string, sourcePage: string): JournalQuote {
  return { id, text, author, work, source: `https://zh.wikisource.org/wiki/${sourcePage}` }
}

// 古诗词使用已核对的公有领域原文，繁体转简体；署名和出处随正文展示。
export const journalQuotes: readonly JournalQuote[] = [
  ...originalQuotes.map((text, index) => ({ id: `original-${index + 1}`, text, author: 'Genesis' })),
  poem('mountain-rain', '空山新雨后，天气晚来秋。', '王维', '山居秋暝', '山居秋暝'),
  poem('moon-pines', '明月松间照，清泉石上流。', '王维', '山居秋暝', '山居秋暝'),
  poem('clouds', '行到水穷处，坐看云起时。', '王维', '终南别业', '終南別業'),
  poem('bamboo-moon', '深林人不知，明月来相照。', '王维', '竹里馆', '輞川集_(王維)/竹里館'),
  poem('walk-in-rain', '莫听穿林打叶声，何妨吟啸且徐行。', '苏轼', '定风波', '定風波_(莫聽穿林打葉聲)'),
  poem('shared-moon', '但愿人长久，千里共婵娟。', '苏轼', '水调歌头', '水調歌頭_(明月幾時有)'),
  poem('chrysanthemums', '采菊东篱下，悠然见南山。', '陶渊明', '饮酒·其五', '飲酒二十首#其五'),
  poem('evening-birds', '山气日夕佳，飞鸟相与还。', '陶渊明', '饮酒·其五', '飲酒二十首#其五'),
  poem('lone-cloud', '众鸟高飞尽，孤云独去闲。', '李白', '独坐敬亭山', '獨坐敬亭山'),
  poem('jingting', '相看两不厌，只有敬亭山。', '李白', '独坐敬亭山', '獨坐敬亭山'),
  poem('river-sea', '白日依山尽，黄河入海流。', '王之涣', '登鹳雀楼', '登鸛雀樓_(王之渙)'),
  poem('higher-view', '欲穷千里目，更上一层楼。', '王之涣', '登鹳雀楼', '登鸛雀樓_(王之渙)'),
]

export const journalImages = [
  { id: 'forest', src: '/images/blog/forest.jpg', position: 'center 48%' },
  { id: 'coast', src: '/images/blog/hero-coast.jpg', position: 'center center' },
  { id: 'dunes', src: '/images/blog/hero-dunes.jpg', position: 'center center' },
  { id: 'snow', src: '/images/blog/hero-snow.jpg', position: 'center center' },
  { id: 'mist', src: '/images/blog/hero-mist.jpg', position: 'center center' },
] as const

export interface JournalSelection { imageId: string; quoteId: string }
export const journalSelectionKey = 'genesis.blog.hero.previous.v1'

/** 两项分别排除上次结果，避免刷新后只换文字或只换图片。 */
export function pickJournalScene(previous?: Partial<JournalSelection>, random = Math.random) {
  const images = journalImages.filter(image => image.id !== previous?.imageId)
  const quotes = journalQuotes.filter(quote => quote.id !== previous?.quoteId)
  return {
    image: images[Math.floor(random() * images.length)] ?? journalImages[0],
    quote: quotes[Math.floor(random() * quotes.length)] ?? journalQuotes[0]!,
  }
}

export function readPreviousJournalSelection(): Partial<JournalSelection> | undefined {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(journalSelectionKey) ?? 'null')
    if (!value || typeof value !== 'object') return undefined
    return {
      imageId: 'imageId' in value && typeof value.imageId === 'string' ? value.imageId : '',
      quoteId: 'quoteId' in value && typeof value.quoteId === 'string' ? value.quoteId : '',
    }
  } catch { return undefined }
}

export function rememberJournalSelection(selection: JournalSelection) {
  // 浏览器禁用本地存储时仍可正常展示，只失去跨刷新去重。
  try { window.localStorage.setItem(journalSelectionKey, JSON.stringify(selection)) } catch { /* 无需打断阅读。 */ }
}
