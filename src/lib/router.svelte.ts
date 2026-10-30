import { Router } from '$shared/lib/router.svelte'

// Settings sections, each its own page under #/settings/<section>.
export const SECTIONS = {
  push: 'Notifications on this device',
  messages: 'Encrypted messages',
  connection: 'Connection to X',
  agents: 'Agents',
  cost: 'What this has cost',
} as const
export type Section = keyof typeof SECTIONS

export type Route =
  | { view: 'write' }
  | { view: 'notifications' }
  | { view: 'detail'; id: string }
  | { view: 'posts' }
  | { view: 'post'; id: string; quote: boolean }
  | { view: 'settings'; section: Section | null }
  | { view: 'messages' }
  | { view: 'chat'; id: string }
  | { view: 'profile'; id: string }

export const router = new Router<Route>({
  home: '/',
  parse(path) {
    const detail = path.match(/^\/n\/(.+)$/)
    if (detail) return { view: 'detail', id: decodeURIComponent(detail[1]) }
    // /p/ is one of yours, /t/ any post a link points at. Same screen.
    const post = path.match(/^\/[pt]\/(\d+)(\/quote)?$/)
    if (post) return { view: 'post', id: post[1], quote: !!post[2] }
    const chat = path.match(/^\/m\/(\d+)$/)
    if (chat) return { view: 'chat', id: chat[1] }
    const profile = path.match(/^\/u\/(\d+)$/)
    if (profile) return { view: 'profile', id: profile[1] }
    if (path === '/messages') return { view: 'messages' }
    if (path === '/posts') return { view: 'posts' }
    if (path === '/notifications') return { view: 'notifications' }
    if (path === '/settings') return { view: 'settings', section: null }
    const setting = path.match(/^\/settings\/(\w+)$/)
    if (setting && setting[1] in SECTIONS) return { view: 'settings', section: setting[1] as Section }
    return { view: 'write' }
  },
})
