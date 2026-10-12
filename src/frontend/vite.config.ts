import { defineConfig, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'

// Reviewers quote this id in feedback, so it must match the packaged build rather than be guessed.
const environment = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}
const buildStamp = environment.PROTOTYPE_BUILD_ID || `${new Date().toISOString().slice(0, 16).replace('T', ' ')}Z`

const backend = 'http://localhost:5094'
const demoProxy = (): ProxyOptions => ({
  target: backend,
  changeOrigin: true,
  configure(proxy) {
    proxy.on('proxyReq', (proxyRequest, request) => {
      // Rewrite only a browser's same-origin, loopback development request.
      // Foreign Origins must reach the backend unchanged and remain forbidden.
      const origin = request.headers.origin
      const host = request.headers.host
      if (host && /^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(host)
        && origin === `http://${host}`) {
        proxyRequest.setHeader('Origin', backend)
      }
    })
  },
})

export default defineConfig(({ command, isPreview }) => ({
  plugins: [react()],
  define: { __PROTOTYPE_BUILD__: JSON.stringify(buildStamp) },
  server: {
    host: '127.0.0.1',
    // Atomic editor temporary directories may be briefly locked on Windows.
    watch: { ignored: ['**/*.tmpdir/**', '**/*.tmpdir', '**/*.tmp'] },
    // Development only; do not expose a production authentication bypass.
    ...(command === 'serve' && !isPreview
      ? { proxy: { '/api': demoProxy(), '/health': demoProxy() } }
      : {}),
  },
  preview: { host: '127.0.0.1' },
}))
