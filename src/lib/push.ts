import { apiJson } from './api'
import { makePush } from '$shared/lib/push'

// Push on this device (kit push/). The flag key is notime's.
export type { PushState } from '$shared/lib/push'
export const { pushState, enablePush, disablePush, keepPush, testPush } = makePush({ apiJson, storageKey: 'notime.push.v1' })
