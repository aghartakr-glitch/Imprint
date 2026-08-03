import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const anthropicProxy = {
  '/anthropic': {
    target: 'https://api.anthropic.com',
    changeOrigin: true,
    rewrite: path => path.replace(/^\/anthropic/, ''),
    headers: {
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
  },
}

const googleAppsScriptProxy = {
  '/gas': {
    target: 'https://script.google.com',
    changeOrigin: true,
    secure: true,
    followRedirects: true,
    rewrite: path => path.replace(/^\/gas/, ''),
    configure: proxy => {
      proxy.on('proxyRes', proxyRes => {
        const location = proxyRes.headers.location
        if (location?.startsWith('https://script.googleusercontent.com/')) {
          proxyRes.headers.location = location.replace('https://script.googleusercontent.com', '/gasusercontent')
        }
      })
    },
  },
  '/gasusercontent': {
    target: 'https://script.googleusercontent.com',
    changeOrigin: true,
    secure: true,
    followRedirects: true,
    rewrite: path => path.replace(/^\/gasusercontent/, ''),
  },
}

const compileServerProxy = {
  '/compile-api': {
    target: 'http://localhost:8789',
    changeOrigin: true,
    rewrite: path => path.replace(/^\/compile-api/, '/api'),
  },
  '/compile-outputs': {
    target: 'http://localhost:8789',
    changeOrigin: true,
    rewrite: path => path.replace(/^\/compile-outputs/, '/outputs'),
  },
}

const proxy = {
  ...anthropicProxy,
  ...googleAppsScriptProxy,
  ...compileServerProxy,
}

export default defineConfig({
  plugins: [react()],
  server: { proxy, port: parseInt(process.env.PORT || '5173') },
  preview: { proxy, port: parseInt(process.env.PORT || '4173') },
})
