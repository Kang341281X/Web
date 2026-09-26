import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'

// Element Plus 图标名集合：用于给 <Search />、<el-icon><Plus /></el-icon> 这类
// 模板里裸用的图标组件做按需解析（unplugin 没有内置 icons-vue 的 resolver，这里手写一个）
const iconNames = new Set(Object.keys(ElementPlusIconsVue))
const iconsResolver = name => (iconNames.has(name) ? { name, from: '@element-plus/icons-vue' } : undefined)

export default defineConfig({
  plugins: [
    vue(),
    // Element Plus 按需引入：模板里的 <el-xxx> 与图标组件只在真正用到的文件里自动 import，
    // 同时按组件注入样式（element-plus/es/components/xxx/style/css），不再打包全量 JS + CSS
    Components({
      resolvers: [ElementPlusResolver(), iconsResolver],
      // 本项目是纯 JS（无 tsconfig），不生成 dts 声明文件
      dts: false,
    }),
    // ElMessage / ElMessageBox 等函数式 API 的自动引入（已显式 import 的文件不受影响）
    AutoImport({
      resolvers: [ElementPlusResolver()],
      dts: false,
    }),
  ],
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
  },
  // npm run preview（本地预览生产构建）沿用同一份 API 代理
  preview: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      }
    }
  }
})
