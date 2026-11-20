const journalQuotes = [
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
] as const

const dayMilliseconds = 86_400_000
const shanghaiOffset = 8 * 60 * 60 * 1000

/** 按北京时间轮换原创短句，同一天刷新或切换筛选时保持稳定。 */
export function getDailyJournalQuote(date = new Date()): string {
  const day = Math.floor((date.getTime() + shanghaiOffset) / dayMilliseconds)
  return journalQuotes[((day % journalQuotes.length) + journalQuotes.length) % journalQuotes.length] ?? journalQuotes[0]
}

export function millisecondsUntilNextJournalDay(date = new Date()): number {
  return dayMilliseconds - ((date.getTime() + shanghaiOffset) % dayMilliseconds)
}
