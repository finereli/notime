import { Router } from '$shared/lib/router.svelte'

export type Route =
  | { view: 'write' }
  | { view: 'notifications' }
  | { view: 'detail'; id: string }
  | { view: 'posts' }
  | { view: 'post'; id: string; quote: boolean }
  | { view: 'settings' }
  | { view: 'messages' }
  | { view: 'chat'; id: string }

export const router = new Router<Route>({
  home: '/',
  parse(path) {
    const detail = path.match(/^\/n\/(.+)$/)
    if (detail) return { view: 'detail', id: decodeURIComponent(detail[1]) }
    const post = path.match(/^\/p\/(\d+)(\/quote)?$/)
    if (post) return { view: 'post', id: post[1], quote: !!post[2] }
    const chat = path.match(/^\/m\/(\d+)$/)
    if (chat) return { view: 'chat', id: chat[1] }
    if (path === '/messages') return { view: 'messages' }
    if (path === '/posts') return { view: 'posts' }
    if (path === '/notifications') return { view: 'notifications' }
    if (path === '/settings') return { view: 'settings' }
    return { view: 'write' }
  },
})
