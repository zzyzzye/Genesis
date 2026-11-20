import { describe, expect, it } from 'vitest'
import { getDailyJournalQuote, millisecondsUntilNextJournalDay } from '../src/features/blog/journalQuotes'

describe('每日原创短句', () => {
  it('同一个北京时间自然日保持相同内容，在午夜切换', () => {
    const morning = new Date('2026-11-19T16:00:00Z')
    const evening = new Date('2026-11-20T15:59:59Z')
    const nextDay = new Date('2026-11-20T16:00:00Z')
    expect(getDailyJournalQuote(morning)).toBe(getDailyJournalQuote(evening))
    expect(getDailyJournalQuote(nextDay)).not.toBe(getDailyJournalQuote(evening))
    expect(millisecondsUntilNextJournalDay(evening)).toBe(1000)
    expect(millisecondsUntilNextJournalDay(nextDay)).toBe(86_400_000)
  })
})
