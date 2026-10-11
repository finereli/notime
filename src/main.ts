// pwa-kit: shell/src/main.ts v6
import './app.css'
import { mount } from 'svelte'
import App from './App.svelte'
import { updates } from '$shared/lib/updates.svelte'

// A new version never reloads a live session. Pass a veto for the moments a
// silent reload would hurt (audio playing, upload in flight):
//   updates.init({ canReload: () => !player.playing })
updates.init()

export default mount(App, { target: document.getElementById('app')! })
