# Team Client Frontend Design

English | [中文](frontend-design.zh.md)

This document records the long-lived UI system for `packages/client-agent-team/src/client/`: principles, layout, typography, color and identity, component contracts, interaction patterns, accessibility, and verification. It captures stable decisions rather than active work or short-lived plans. Source and tests define behavior; fix this document when they disagree.

## Design principles

1. Reuse Harness public primitives from `@deepseek-ai/dsh-client-ui-primitives`: `MarkdownText`, `MessageText`, `Button`, `Pill`, `Modal`, `Tooltip`, `Input`, `StateDot`, icons, and the dismissal/max-height hooks. Team does not reimplement them; the composer textarea is the single-line `Input` exception.
2. Use only aliases actually defined by `@deepseek-ai/dsh-client-ui-theme`: `--dsw-alias-label-*`, border, background, interactive, state, shadow, and specific tokens. Team variables may only be derived values such as avatar hue. Undefined `var()` values silently fall back to `initial`, so never guess token names.
3. Prefer chat density over assistant-document density: body text is the 14px scale and Markdown spacing is tightened locally.
4. Use progressive disclosure: quiet borders and no fill by default; hover/focus elevate feedback; secondary information uses tertiary color.
5. Durable mutations are not optimistic. Preserve input on failure and render the next Host projection, using `mergeChannelView` rather than replacing the whole view.
6. Every custom composite control has roles, ARIA state, and a complete keyboard path.

## Layout skeleton

Channel and Thread surfaces use `display:grid; grid-template-rows: auto 1fr auto` for header, scrollable timeline, and composer at `height:100%`, with contained inner scrolling. The content column is centered at `max-width: 880px`; timeline padding is `clamp(18px, 3vw, 36px)`. At `max-width: 600px`, padding tightens and the header stacks; acceptance covers 390×844 without horizontal overflow. The host sidebar controls wide/rail widths; rail renders Team icon buttons.

Browser storage retains Team mode, Workspace, and the last Channel/Thread location, but never unread or Attention. Welcome is a separate centered surface. Thread is the navigation endpoint; an existing Task is a header/card overlay. Taskless Threads show a localized Thread/讨论 label and a promote action, not fake status or Claims. Closed Tasks replace the composer with an explanatory notice and reopen action; taskless Threads retain the normal reply composer.

Channel and Thread pages are symmetric. Both subscribe to workspace changes through the shared abortable `TeamChangeStream`; its first probe is silent and later parked-poll changes wake subscribers. Channel top-level and Thread replies are idempotent by request ID. The Channel 「作为任务」 control is a default-off native pressed control, sends explicit taskless intent unless selected, and resets off after success.

## Typography and identity

| Element | Specification |
| --- | --- |
| Page h1 | 20px/28px, weight 600 |
| Sender | 13px/20px, weight 600, primary; time metadata follows on the same line |
| Message time | 11px/20px, tertiary; local HH:mm today, MM-DD HH:mm this year, full date across years |
| Human body | 14px/22px, pre-wrap and break-word |
| Agent body | Markdown on the same 14px/22px grid; compact heading sizes and list/pre/table margins |
| Task/activity | 11–12px tertiary, centered activity rows |
| Empty/loading | 13px tertiary; 8px pulsing dots, disabled for reduced motion |

Message time comes from Host projection and shares the ledger operation instant. Consecutive same-sender messages form a run; an interval of at least five minutes gets a `TeamRunDivider`. A day boundary gets a centered date anchor. `team-separators.ts` is the single authority for both decisions.

Agent avatar hue is a stable hash of `memberId`; Human uses `--dsw-alias-state-business-primary`. Presence maps available/working/error/unavailable to the shared state-dot language. Errors use `--dsw-alias-state-error-primary` and `role="alert"`.

## Component contracts

### TeamMessage

Props include sender identity, body, optional time, mention handles, sender title, grouping, and children. Only adjacent same-sender Message rows group; Activity rows break runs. Grouped rows hide avatar/name while preserving grid alignment. The initial of the sender name (without `@`) is shown.

Bodies over the 600-character formatter threshold use a persistent wrapper with an approximately eight-line/176px preview and quiet “expand/collapse” button carrying `aria-expanded`. Keep the wrapper mounted so Markdown-injected refs and mention chips survive. Attachments, fallback chips, Task cards, and children stay outside the collapsible body.

### Message runs

A run groups consecutive same-sender Messages and its Task entry card. Activity and unread boundaries break runs. A Task entry in a grouped row gets a hairline; ordinary continuation does not. Runs have no hover box, fill, shadow, or permanent border—only two-pixel spacing. Five-minute dividers and day anchors carry time context.

### Mentions and Task refs

Structured mention chips are rendered only for handles allowed by `mentions`, case-insensitively and with optional `@`. Human literal, Agent plain prose, and rich Markdown use their corresponding segmentation path; absent names become a trailing fallback row without duplication.

Known branded `task:*` refs are resolved in batches and rendered at their original position as clickable `Task #N` in Human, plain Agent, and rich Markdown text. Code fences, indented code, mixed inline code, and existing links stay literal. Normalize malformed double-colon or uppercase spellings before resolution. Resolved refs can navigate across Workspace, Channel, and Thread; failed refs remain plain text. Task numbers are home-Channel creation ordinals, while branded refs remain stable identity.

## Timeline scrolling

When the reader is within 48px of the bottom, follow new content; away from the bottom, do not disturb. Every arrival while a Thread is open is acknowledged durably right away, whether or not the reader is pinned — a scrolled-away reader gets only the pure “↓ N new update(s)” jump hint, which scrolls to the tail without any read semantics and clears when the reader returns to the bottom. Opening a Thread scrolls to the latest fact, and a bounded read with a remaining unread count continues automatically: a serial drain loop issues fresh-requestId reads until the remainder is zero (50-round cap surfaces an error). Compensate `scrollTop` by the `scrollHeight` delta when prepending history. Rendering keys change with facts; a current length plus last fact key is used.

## Composer and mentions

The textarea grows to 180px, autofocuses without moving the timeline, sends on Enter, and inserts a newline on Shift+Enter. IME composition suppresses send. During submit it stays focused and read-only; buttons do not steal focus. Confirmation for an unfollowed recipient preserves draft and focus for the second Enter.

The mention popup is an upward `role="listbox"` associated through `aria-controls`, `aria-activedescendant`, and `aria-expanded`; arrows cycle, Tab/Enter accept, Escape closes, and outside dismissal/max height use public hooks. Accepted text places the caret precisely; deleting mention text shrinks recipients. A quiet recipient notice shows who will be notified. Drafts and recipients are stored per Channel/Thread in the bounded `TeamDraftStore`; successful sends clear them and failures preserve them. The 「作为任务」 intent is not persisted and resets off after success.

Taskless Thread promotion is Human-only, durable, and non-optimistic. On success reread Thread and supplemental Channel/Member projections; on unread/stale fence errors preserve Host error and reread relevant facts.

## Thread/Task entry cards

Every top-level Channel Message has one Thread entry. Taskful cards show `Task #N`, status, and message count; taskless cards show localized Thread/讨论, count, and chevron. Both select the Thread, never treating Task as a navigation level. Task cards use compact fit-content capsules and all five status dots; taskless cards have no invented status dot. `aria-label` follows card type (`openTask` or `openThread`).

## Sidebar browser

Workspace list and persistent Channels/Agents sections use native button headers with `aria-expanded`, default expanded and not persisted. Rows remain quiet: Channels keep `#`; Agent rows use avatars and presence. Only the active leaf row has `aria-current="page"`; a selected Workspace row changes its folder icon without competing highlight. Row ellipsis menus use public `Menu`, are visible on hover/focus/menu-open, and pin the row background while open.

Channel and Agent editors use public Remote mutations and Host projections rather than optimistic inline edits. Agent model selection uses the public menu and Host model directory; changing an active model preserves Member and Session identity. Selecting an Agent opens its embedded Session without leaving Team mode; explicit Team navigation closes that overlay. On narrow rail, the two icon buttons expand the sidebar and focus their section header. Agent creation carries no Channel page and the Agent editor carries no membership section: Channel membership is managed from the Channel side (create-dialog initial members, Channel editor member rows, and the member-management dialog); a Channel-less Member stays reachable through its DM view.

The embedded Member Session input surface is the shipped composer itself (rc.1 moved the trigger-menu overlay into `conversation.composer.bar`'s children, so the Team no longer shadows that seat): the keyboard contract, `/` and `@` menus, and attachments all come from the shipped InputBar. The two Team trigger sources register through the public trigger registry and filter by session — `/compact` claims the Team compact transaction (menu pick or typed line via `matchEnter`), `@` inserts a structured Member ref without notifying. The Team-owned surface is a hint strip in the public `conversation.input.dock` slot above the bar (`TeamMemberDock`: vocabulary hint plus the Member turn's prompt error through the standard `useSession` hook), rendered in both the hero (blank session) and active forms.

## Data refresh semantics

Channel refreshes deduplicate by `messageRef`, merge new and loaded history through `mergeChannelView`, retain the older cursor, and combine `hasMore`. Thread passive changes merge into current facts; the durable read pointer advances automatically on open and on every arrival (a bounded read's remainder drains through the serial continuation loop), and `newFactsCount` only drives the pure jump hint. `loadOlder` has concurrency protection.

## Copy and localization

All visible copy comes from structurally matching zh/en locale keys, whose types derive from zh. Parameter conventions are `{count}`, `{ids}`, `{kind}`, `{number}`, `{actor}`, and `{direction}`. Show raw Host error messages where useful, wrapped by locale-key copy.

## Accessibility baseline

Section headers, expand/collapse buttons, menus, listbox/options, and the 「作为任务」 control use native keyboard behavior and complete ARIA state. Every icon button has an accessible label; decoration is hidden. Timeline uses a dedicated message-timeline label. Unread and run dividers have `role="separator"`; visible UI changes require desktop 1440×960, 390×844, and keyboard browser checks.

## Verification and evolution

Visible UI, Client bundle, slot, or Remote activation changes require:

```sh
npm run typecheck && npm test && npm run lint && npm run build && npm run test:browser
```

Thread-first changes additionally cover default taskless sends, default-off keyboard toggle, promotion Host reread, taskless gating, desktop, and 390×844. Routine screenshots stay in ignored `artifacts/browser/`; only a few acceptance images with a README belong in the archive. Behavior changes update this document in the same change; historical rationale belongs in `.scratch/archive/`.
