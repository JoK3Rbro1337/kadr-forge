import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { AgentProvider } from '@shared/types'
import { useEditor } from '@/state/store'
import { activity } from '@/engine/autosave'
import { useT } from '@/i18n'

/** Embedded Codex/Claude TUI connected to the live Kadr project over MCP. */
export function AgentPanel({
  provider,
  onClose
}: {
  provider: AgentProvider
  onClose: () => void
}) {
  const t = useT()
  const holder = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!holder.current) return
    activity.agent = true
    const term = new Terminal({
      fontSize: 13,
      fontFamily: 'monospace',
      cursorBlink: true,
      convertEol: false,
      theme: {
        background: '#101218',
        foreground: '#d8dce6',
        cursor: '#7fc4ff'
      }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(holder.current)
    fit.fit()

    const offData = window.kadr.onAgentData((data) => term.write(data))
    const offExit = window.kadr.onAgentExit(() => {
      term.write(`\r\n\x1b[90m${t('agentExited')}\x1b[0m\r\n`)
    })
    const onData = term.onData((data) => window.kadr.agentInput(provider, data))

    const ro = new ResizeObserver(() => {
      fit.fit()
      window.kadr.agentResize(provider, term.cols, term.rows)
    })
    ro.observe(holder.current)

    const projectPath = useEditor.getState().projectPath
    const cwd = projectPath ? projectPath.replace(/[/\\][^/\\]*$/, '') : null
    let dead = false
    window.kadr.agentOpen(provider, term.cols, term.rows, cwd).then((result) => {
      if (dead) return
      if (!result.ok) {
        term.write(
          `\x1b[31m${t('agentFailed')} ${provider}: ${result.error ?? ''}\x1b[0m\r\n`
        )
      } else {
        term.focus()
      }
    })
    term.focus()

    return () => {
      dead = true
      activity.agent = false
      ro.disconnect()
      onData.dispose()
      offData()
      offExit()
      void window.kadr.agentClose(provider)
      term.dispose()
    }
    // `key={provider}` in App remounts the whole terminal when switching.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const providerName = provider === 'codex' ? 'Codex' : 'Claude Code'
  return (
    <div className="agent-panel">
      <div className="floating-panel-head">
        <span>🤖 {providerName}</span>
        <span className="dim floating-panel-hint">{t('agentHint')}</span>
        <button className="floating-panel-close" title={t('agentClose')} onClick={onClose}>✕</button>
      </div>
      <div className="agent-term" ref={holder} />
    </div>
  )
}
