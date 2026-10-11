// pwa-kit: shell/src/main.ts v6
import './app.css'
import { mount } from 'svelte'
import App from './App.svelte'
import { updates } from '$shared/lib/updates.svelte'
import { sending } from './lib/send.svelte'

// A new version never reloads a live session, and never while a post is on
// its way to X: a reload between the second and third post of a thread would
// be a bad moment.
updates.init({ canReload: () => !sending.active })

export default mount(App, { target: document.getElementById('app')! })
