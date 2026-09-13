import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  build: {
    // 与 package.json 的 browserslist 保持同一套目标（最新两版 Chrome / Firefox / Edge）。
    // esbuild 压缩 CSS 时会依据 cssTarget 决定是否转换语法（如 inset 展开、颜色写法改写），
    // 不显式声明就会跟随 build.target 的默认值（含更老的 edge88 / safari14），
    // 与 autoprefixer 的目标不一致，可能把刚补好的写法再改回去。
    cssTarget: ['chrome120', 'firefox120', 'edge120']
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      }
    }
  }
})
