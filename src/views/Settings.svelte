<script lang="ts">
  // Settings, the kit's multi-pane shape: an index whose rows sum up each
  // section's current state, and one page per section (#/settings/<section>).
  import SettingsPage from '$shared/ui/SettingsPage.svelte'
  import SettingsRow from '$shared/ui/SettingsRow.svelte'
  import Agents from './settings/Agents.svelte'
  import Chat from './settings/Chat.svelte'
  import Connection from './settings/Connection.svelte'
  import Cost from './settings/Cost.svelte'
  import Push from './settings/Push.svelte'
  import { money, settings as s, when } from '../lib/settings.svelte'
  import { SECTIONS, type Section } from '../lib/router.svelte'
  import './settings/local.css'

  let { section }: { section: Section | null } = $props()
  s.load()

  const PUSH: Record<string, string> = { on: 'On', off: 'Off', denied: 'Blocked in device settings', 'needs-install': 'Add to home screen first', unsupported: 'Not on this browser' }
  const sub = $derived({
    push: s.push ? PUSH[s.push] ?? s.push : '',
    messages: s.chat ? (s.chat.unlocked ? 'Unlocked' : 'Locked: enter your X Chat PIN') : '',
    connection: s.status ? (s.healthy ? (s.status.lastEventAt ? `Delivering, last heard ${when(s.status.lastEventAt)}` : 'Connected') : 'Something is not connected') : s.statusFailed ? 'Could not check' : '',
    agents: s.agents ? (s.agents.items.length ? `${s.agents.items.length} with access` : 'None has access') : '',
    cost: s.usage ? [s.usage.credits ? `${money(s.usage.credits.total)} left on X` : '', s.usage.since ? `${money(s.usage.spent)} spent` : ''].filter(Boolean).join(', ') : '',
  } satisfies Record<Section, string>)
</script>

{#if section}
  <SettingsPage title={SECTIONS[section]} back="/settings">
    {#if section === 'push'}<Push />
    {:else if section === 'messages'}<Chat />
    {:else if section === 'connection'}<Connection />
    {:else if section === 'agents'}<Agents />
    {:else if section === 'cost'}<Cost />{/if}
  </SettingsPage>
{:else}
  <SettingsPage title="Settings">
    <ul class="rows">
      <SettingsRow href="#/settings/push" title={SECTIONS.push} sub={sub.push} />
      {#if s.chat?.ready}<SettingsRow href="#/settings/messages" title={SECTIONS.messages} sub={sub.messages} />{/if}
      <SettingsRow href="#/settings/connection" title={SECTIONS.connection} sub={sub.connection} />
      <SettingsRow href="#/settings/agents" title={SECTIONS.agents} sub={sub.agents} />
      <SettingsRow href="#/settings/cost" title={SECTIONS.cost} sub={sub.cost} />
    </ul>
  </SettingsPage>
{/if}
