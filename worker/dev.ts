import type { Env } from './env'

// The dev bypass needs two things to be true at once: the deployment opted in
// with DEV_AUTH, and the request arrived on a local host. A hostname alone is
// not an auth boundary, and neither is a variable someone might set by mistake.
export function isDev(env: Env, url: URL): boolean {
  if (env.DEV_AUTH !== 'allow') return false
  const h = url.hostname
  return h === 'localhost' || h === '127.0.0.1'
}

export function appOrigin(env: Env, url: URL): string {
  return env.APP_ORIGIN || url.origin
}
