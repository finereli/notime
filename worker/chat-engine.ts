// The two WASM modules X Chat needs, loaded the way a Worker loads WASM: as a
// compiled module the bundler hands us. Kept apart from chat.ts so the tests
// can load the same code from disk instead.
// @ts-ignore: the package's own .d.ts describes the instance, not the module
import chatWasm from '../node_modules/@xdevplatform/chat-xdk/pkg/chat_xdk_wasm_bg.wasm'
import { Chat, initSync } from '../node_modules/@xdevplatform/chat-xdk/pkg/chat_xdk_wasm.js'
import juiceboxWasm from '../node_modules/juicebox-sdk/juicebox-sdk_bg.wasm'
// @ts-ignore: no types for the glue
import * as juicebox from '../node_modules/juicebox-sdk/juicebox-sdk_bg.js'
import type { ChatRuntime } from './chat'

let chatReady = false
let juiceboxReady = false

export const runtime: ChatRuntime = {
  newChat() {
    if (!chatReady) {
      initSync({ module: chatWasm })
      chatReady = true
    }
    return new Chat()
  },
  juicebox() {
    // Only unlocking needs it, so it is instantiated on first use.
    if (!juiceboxReady) {
      const instance = new WebAssembly.Instance(juiceboxWasm, { './juicebox-sdk_bg.js': juicebox as any })
      ;(juicebox as any).__wbg_set_wasm(instance.exports)
      juiceboxReady = true
    }
    return juicebox as any
  },
}
