// Push the Worker's secrets to Cloudflare from .env, in one call, through
// stdin so no value lands in a file, an argument list or the terminal.
import { spawn } from 'node:child_process'
import { readEnv, workerSecrets } from './env.mjs'

const secrets = workerSecrets(readEnv())
const child = spawn('npx', ['wrangler', 'secret', 'bulk'], { stdio: ['pipe', 'inherit', 'inherit'] })
child.stdin.end(JSON.stringify(secrets))
child.on('exit', (code) => process.exit(code ?? 1))
