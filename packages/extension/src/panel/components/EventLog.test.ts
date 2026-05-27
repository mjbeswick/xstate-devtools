import { describe, expect, it } from 'vitest'
import { eventMatchesFilter, syncEventLogScroll } from './EventLog.js'

describe('eventMatchesFilter', () => {
  it('keeps non-matching events when only negated tokens are provided', () => {
    expect(eventMatchesFilter('PLAYER.START', '-weight')).toBe(true)
    expect(eventMatchesFilter('PLAYER.WEIGHT_UPDATED', '-weight')).toBe(false)
  })

  it('supports combining positive and negated tokens', () => {
    expect(eventMatchesFilter('PLAYER.START', 'player -weight')).toBe(true)
    expect(eventMatchesFilter('PLAYER.WEIGHT_UPDATED', 'player -weight')).toBe(false)
    expect(eventMatchesFilter('CART.START', 'player -weight')).toBe(false)
  })
})

describe('syncEventLogScroll', () => {
  it('scrolls to the bottom when live auto-scroll is enabled and new events arrive', () => {
    const container = { scrollTop: 0, scrollHeight: 240 }

    syncEventLogScroll(container, {
      autoScroll: true,
      collapsed: false,
      latestEventSeq: 3,
      previousLatestEventSeq: 2,
      previousScrollTop: 0,
      timeTravelSeq: null,
    })

    expect(container.scrollTop).toBe(240)
  })

  it('does not scroll when auto-scroll is disabled', () => {
    const container = { scrollTop: 80, scrollHeight: 240 }

    syncEventLogScroll(container, {
      autoScroll: false,
      collapsed: false,
      latestEventSeq: 3,
      previousLatestEventSeq: 2,
      previousScrollTop: 25,
      timeTravelSeq: null,
    })

    expect(container.scrollTop).toBe(25)
  })

  it('does not scroll when there are no new events or time travel is active', () => {
    const container = { scrollTop: 10, scrollHeight: 240 }

    syncEventLogScroll(container, {
      autoScroll: true,
      collapsed: false,
      latestEventSeq: 2,
      previousLatestEventSeq: 2,
      previousScrollTop: 4,
      timeTravelSeq: null,
    })
    expect(container.scrollTop).toBe(10)

    syncEventLogScroll(container, {
      autoScroll: true,
      collapsed: false,
      latestEventSeq: 3,
      previousLatestEventSeq: 2,
      previousScrollTop: 4,
      timeTravelSeq: 7,
    })

    expect(container.scrollTop).toBe(4)
  })

  it('preserves scroll when the log is capped and a new event replaces an old one', () => {
    const container = { scrollTop: 120, scrollHeight: 500 }

    syncEventLogScroll(container, {
      autoScroll: false,
      collapsed: false,
      latestEventSeq: 501,
      previousLatestEventSeq: 500,
      previousScrollTop: 42,
      timeTravelSeq: null,
    })

    expect(container.scrollTop).toBe(42)
  })
})