import { defineStore } from '@deepseek-ai/dsh-client-runtime/client'

export function createPanelStore() {
  return defineStore({
    init: () => ({ open: false }),
    actions: {
      setOpen(draft, value: boolean) {
        draft.open = value
      },
    },
  })
}
