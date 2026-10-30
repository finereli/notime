// Write .dev.vars for `wrangler dev` from .env. DEV_AUTH turns on the local
// stand-in for X (see worker/dev.ts); pass --real to leave it off and sign in
// with X for real on 127.0.0.1:8787.
import { writeFileSync } from 'node:fs'
import { readEnv, workerSecrets } from './env.mjs'

const real = process.argv.includes('--real')
const vars = { ...workerSecrets(readEnv(), { fake: !real }), APP_ORIGIN: 'http://127.0.0.1:8787', ...(real ? {} : { DEV_AUTH: 'allow' }) }
writeFileSync('.dev.vars', Object.entries(vars).map(([k, v]) => `${k}=${v}`).join('\n') + '\n')
console.log(`Wrote .dev.vars (${Object.keys(vars).length} values, ${real ? 'real X' : 'fake X'})`)
