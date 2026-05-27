import { Component } from 'react'

export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[PlanLess] Uncaught error:', error, info?.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg, #0f0f0f)',
          padding: 24,
        }}>
          <div style={{ maxWidth: 480, textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink, #fff)', marginBottom: 8 }}>
              Něco se pokazilo
            </div>
            <div style={{ fontSize: 14, color: 'var(--ink-3, #888)', marginBottom: 24, lineHeight: 1.6 }}>
              Chyba byla zaznamenána. Zkuste obnovit stránku nebo se přihlaste znovu.
            </div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                onClick={() => window.location.reload()}
                style={{
                  padding: '10px 20px',
                  borderRadius: 10,
                  background: 'var(--accent, #f59e0b)',
                  color: '#000',
                  border: 'none',
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Obnovit stránku
              </button>
              <button
                onClick={() => this.setState({ error: null })}
                style={{
                  padding: '10px 20px',
                  borderRadius: 10,
                  background: 'transparent',
                  color: 'var(--ink-2, #ccc)',
                  border: '1px solid var(--line, #333)',
                  fontWeight: 500,
                  fontSize: 14,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Zkusit znovu
              </button>
            </div>
            {import.meta.env.DEV && (
              <pre style={{
                marginTop: 24,
                padding: 16,
                background: 'rgba(248,113,113,0.08)',
                border: '1px solid rgba(248,113,113,0.2)',
                borderRadius: 8,
                fontSize: 11,
                color: '#f87171',
                textAlign: 'left',
                overflow: 'auto',
                maxHeight: 200,
                fontFamily: 'monospace',
              }}>
                {this.state.error?.message}
                {'\n\n'}
                {this.state.error?.stack}
              </pre>
            )}
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
