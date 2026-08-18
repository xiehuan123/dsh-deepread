import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import { errorMessage, type SubmitDeepread } from './models.js'
import { createPanelStore } from './store.js'
import { ComposerButton, DeepReadCard, installStyles, clientCss, Panel } from './view.js'

function submitFromContext(ctx: ClientContext): SubmitDeepread {
  return (instruction) => {
    try {
      const currentId = ctx.sessions.list.getSnapshot().current
      if (currentId === undefined) return '当前没有打开的会话，请先在对话中打开一个会话'
      const sessionCtx = ctx.sessions.scope(currentId)
      if (sessionCtx === undefined) return '精读提交通道不可用，请直接对对话说：请用 deepread 精读 <内容>'
      const input = ctx.conversation.input.for(sessionCtx)
      input.setDraft(instruction)
      input.submit('queue')
      return null
    } catch (error) {
      return errorMessage(error)
    }
  }
}

export const inject = ['slots', 'sessions', 'conversation'] as const

export function apply(ctx: ClientContext): void {
  ctx.effect(() => installStyles(clientCss), 'dsh-deepread: styles')
  const submitDeepread = submitFromContext(ctx)
  type PanelActions = BoundActions<ReturnType<typeof createPanelStore>>
  let panelActions: PanelActions | undefined
  let pendingOpen = false

  ctx.slots.inject('shell.overlay', () => {
    let registeredActions: PanelActions | undefined
    const dispose = ctx.slots.register({
      name: 'shell.overlay',
      id: 'deepread-panel',
      order: 10,
      label: '精读助手面板',
      store: createPanelStore,
      inject: (actions) => {
        registeredActions = actions
        panelActions = actions
        if (pendingOpen) {
          pendingOpen = false
          actions.setOpen(true)
        }
        return { submitDeepread }
      },
    }, Panel)
    return () => {
      if (panelActions === registeredActions) panelActions = undefined
      dispose()
    }
  })
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'deepread-composer',
    order: 30,
    label: '精读',
    inject: () => ({
      openPanel: () => {
        if (panelActions === undefined) pendingOpen = true
        else panelActions.setOpen(true)
      },
    }),
  }, ComposerButton))
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
    { name: 'tool.call.toolview', key: 'deepread' },
    DeepReadCard,
  ))
}
