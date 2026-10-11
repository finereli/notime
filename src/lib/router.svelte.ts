import { Router } from '$shared/lib/router.svelte'

export type Route =
  | { view: 'write' }
  | { view: 'notifications' }
  | { view: 'detail'; id: string }
  | { view: 'drafts' }
  | { view: 'settings' }

export const router = new Router<Route>({
  home: '/',
  parse(path) {
    const detail = path.match(/^\/n\/(.+)$/)
    if (detail) return { view: 'detail', id: decodeURIComponent(detail[1]) }
    if (path === '/notifications') return { view: 'notifications' }
    if (path === '/drafts') return { view: 'drafts' }
    if (path === '/settings') return { view: 'settings' }
    return { view: 'write' }
  },
})
