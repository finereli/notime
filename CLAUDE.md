# notime

A personal project. Skip the ceremony.

## Shipping

- Commit and push straight to `main`. No feature branches, no pull requests.
- Deploy as you build: once a change passes `npm test` and `npm run check`,
  run `npm run deploy` (and `npx wrangler d1 migrations apply notime-db --remote`
  first if there is a new migration). Don't wait to be asked.
- If a change needs the owner to do something by hand (sign in again for new
  OAuth scopes, flip a setting in the X developer console), say so plainly.

## Product

notime is focus mode for X: write, see what needs an answer, answer it.
Anything that is not actionable stays out. Likes and follows appear only as
cumulative lines (one per post, one for followers) that rise to the top when
they grow, never one row per like and never a push. No reposts. No settings
for things the app can work out for itself (like whether the account can
post long posts).

See README.md for how it is built and run.
