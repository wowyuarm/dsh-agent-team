# 02 — 「提到我」entry, page, and navigation

**What to build:** From Team mode the Human opens a home-wide 「提到我」queue (wide card above Workspaces, narrow rail Queue icon with badge), sees one row per mentioned Thread (workspace / channel / Task / title / time), clicks into that Thread, and Back lands on the Thread’s Channel. Opening the queue does not mark read; opening the Thread does.
**Blocked by:** 01
**Status:** complete

- [x] Wide sidebar: 「提到我」card above Workspaces; badge is the summed direct total; hidden at 0; `aria-current` on the card while the page is open
- [x] Narrow rail: Queue icon, then Channels, then Agents; click opens the Inbox page and expands the sidebar; same badge on the icon
- [x] Right pane Inbox list: breadcrumb + 120-character top-level title + relative time; one row per Thread; empty / loading / error states
- [x] Click selects the Thread’s Workspace when needed and opens the Thread; Back goes to that Channel, not to Inbox
- [x] Badge refreshes from unscoped `changes` without fetching the list; the list fetches only while the Inbox page is open
- [x] Navigation restore: reload on the Inbox page returns to Inbox; unread state is still Host-owned
- [x] `npm run test:browser` covers mention → badge → Inbox row → open Thread → badge/row clear, and peer-only traffic does not admit
