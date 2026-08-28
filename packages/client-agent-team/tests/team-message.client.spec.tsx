// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { AgentTeamMemberId } from '@wowyuarm/dsh-agent-team/types'
import { TeamMessage } from '../src/client/TeamMessage.tsx'

afterEach(cleanup)

function hasClassToken(element: Element, token: string): boolean {
  return [...element.classList].some(className => className.includes(token))
}

function spansWithText(container: HTMLElement, text: string): HTMLElement[] {
  return [...container.querySelectorAll('span')].filter(span => span.textContent === text)
}

describe('TeamMessage structured mention rendering', () => {
  it('renders chips inline for plain-prose agent bodies', () => {
    const { container } = render(
      <TeamMessage senderName="Builder" memberId={'member:builder' as AgentTeamMemberId} human={false} body="@lead please look" mentionNames={['lead']} />,
    )
    const chips = spansWithText(container, '@lead')
    expect(chips).toHaveLength(1)
    expect(hasClassToken(chips[0]!, 'mention')).toBe(true)
    const bodyDiv = chips[0]!.closest('div')
    expect(bodyDiv).not.toBeNull()
    expect(hasClassToken(bodyDiv!, 'messageText')).toBe(true)
    expect(container.textContent).toContain('please look')
    expect([...container.querySelectorAll('div')].some(div => hasClassToken(div, 'mentionsRow'))).toBe(false)
  })

  it('falls back to the trailing chip row for rich markdown agent bodies without ref navigation', () => {
    const { container } = render(
      <TeamMessage
        senderName="Builder"
        memberId={'member:builder' as AgentTeamMemberId}
        human={false}
        body={'```js\nconst lead = 1\n```\nping @lead'}
        mentionNames={['lead']}
      />,
    )
    expect(container.textContent).toContain('const lead = 1')
    expect([...container.querySelectorAll('div')].filter(div => hasClassToken(div, 'mentionsRow'))).toHaveLength(1)
    const row = [...container.querySelectorAll('div')].find(div => hasClassToken(div, 'mentionsRow'))
    expect(row?.textContent).toContain('@lead')
    expect([...container.querySelectorAll('div')].some(div => hasClassToken(div, 'messageText'))).toBe(false)
  })

  it('renders mention chips inline in rich markdown once ref navigation exists', () => {
    const { container } = render(
      <TeamMessage
        senderName="Builder"
        memberId={'member:builder' as AgentTeamMemberId}
        human={false}
        body={'**计划**\n\n1. ping @lead about `task:00000000-0000-0000-0000-000000000001`\n2. 回报'}
        mentionNames={['lead', 'builder']}
        onOpenRef={() => {}}
      />,
    )
    // The spelled handle chipifies at its prose position instead of the
    // trailing row; only the name absent from the body keeps a fallback chip.
    const chips = spansWithText(container, '@lead')
    expect(chips).toHaveLength(1)
    expect(hasClassToken(chips[0]!, 'mention')).toBe(true)
    const row = [...container.querySelectorAll('div')].find(div => hasClassToken(div, 'mentionsRow'))
    expect(row?.textContent).toContain('@builder')
    expect(row?.textContent).not.toContain('@lead')
  })

  it('keeps human literal bodies on the inline flow', () => {
    const { container } = render(
      <TeamMessage senderName="human" memberId={'member:human' as AgentTeamMemberId} human body="ping @lead" mentionNames={['lead']} />,
    )
    const chips = spansWithText(container, '@lead')
    expect(chips).toHaveLength(1)
    expect(hasClassToken(chips[0]!.closest('div')!, 'messageText')).toBe(true)
  })
})
