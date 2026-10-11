// The relative ladder from the pwa skill: just now / 5m / 3h / 2d / 2w / date.
export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  if (s < 14 * 86400) return `${Math.floor(s / 86400)}d`
  if (s < 60 * 86400) return `${Math.floor(s / (7 * 86400))}w`
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}
