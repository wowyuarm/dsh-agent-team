// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { AgentTeamMemberId } from '@wowyuarm/dsh-agent-team/types'
import { zh } from '../src/client/locales.ts'
import type { TeamConversationProps } from '../src/client/slots.ts'
import { TeamMessage } from '../src/client/TeamMessage.tsx'

const t = ((key: keyof typeof zh, params?: Record<string, string | number>) => {
  let value: string = zh[key]
  for (const [name, replacement] of Object.entries(params ?? {})) value = value.replace(`{${name}}`, String(replacement))
  return value
}) as TeamConversationProps['t']

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

describe('TeamMessage long-body clamp', () => {
  const longBody = '长消息正文，用于超过折叠阈值。'.repeat(80)

  function clampDivs(container: HTMLElement): HTMLElement[] {
    return [...container.querySelectorAll('div')].filter(div => hasClassToken(div, 'messageClamp'))
  }

  it('starts over-threshold bodies clamped behind the expand control', () => {
    const { container, getByRole } = render(
      <TeamMessage senderName="Builder" memberId={'member:builder' as AgentTeamMemberId} human={false} body={longBody} t={t} />,
    )
    expect(clampDivs(container)).toHaveLength(1)
    const toggle = getByRole('button', { name: '展开全文' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    // The preview still renders the full text into the clamped container, so
    // in-body refs and mentions stay reachable without expanding.
    expect(container.textContent).toContain('用于超过折叠阈值')
  })

  it('expands to the full body and collapses back through the toggle', () => {
    const { container, getByRole } = render(
      <TeamMessage senderName="Builder" memberId={'member:builder' as AgentTeamMemberId} human={false} body={longBody} t={t} />,
    )
    fireEvent.click(getByRole('button', { name: '展开全文' }))
    expect(clampDivs(container)).toHaveLength(0)
    const collapse = getByRole('button', { name: '收起' })
    expect(collapse.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(collapse)
    expect(clampDivs(container)).toHaveLength(1)
    expect(getByRole('button', { name: '展开全文' }).getAttribute('aria-expanded')).toBe('false')
  })

  it('leaves short bodies unclamped without any toggle', () => {
    const { container } = render(
      <TeamMessage senderName="Builder" memberId={'member:builder' as AgentTeamMemberId} human={false} body="短消息" />,
    )
    expect(clampDivs(container)).toHaveLength(0)
    expect(container.querySelector('button')).toBeNull()
  })

  it('keeps the post-render mention chips across expand and collapse', () => {
    // Rich Markdown bodies get mention chips painted into the DOM after
    // render. Toggling the clamp must not remount that subtree, or the
    // imperatively inserted chips vanish.
    const longRichBody = `**计划**\n\n${'折叠回归验证段落，足够长以触发限高预览。'.repeat(40)}\n\n请 @lead 关注 \`task:0123abcd-0000-0000-0000-000000000000\`。`
    const { container, getByRole } = render(
      <TeamMessage
        senderName="Builder"
        memberId={'member:builder' as AgentTeamMemberId}
        human={false}
        body={longRichBody}
        mentionNames={['lead']}
        onOpenRef={() => {}}
        t={t}
      />,
    )
    const chipCount = (): number => spansWithText(container, '@lead').length
    expect(chipCount()).toBe(1)
    fireEvent.click(getByRole('button', { name: '展开全文' }))
    expect(chipCount()).toBe(1)
    fireEvent.click(getByRole('button', { name: '收起' }))
    expect(chipCount()).toBe(1)
  })
})
