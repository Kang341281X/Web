import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { useCartStore } from './stores/cart'
import { useCustomerStore } from './stores/customer'
import { useFavoritesStore } from './stores/favorites'
import { useLanguageStore } from './stores/language'
import './styles/main.css'
import './styles/admin.css'

// Element Plus 已改为按需引入（见 vite.config.js 的 unplugin-vue-components）：
// 模板组件与图标在用到的文件里自动 import，中文 locale 由 App.vue 的 <el-config-provider> 提供。
// ElMessage / ElMessageBox 这类「函数式调用」的组件不经过模板，unplugin 无法感知，
// 样式需要显式引入（各文件里 import { ElMessage } 的 JS 部分本身可摇树）。
import 'element-plus/es/components/message/style/css'
import 'element-plus/es/components/message-box/style/css'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.use(router)

// 带着登录态刷新页面时，购物车/收藏优先从服务端初始化（未登录时保持读 localStorage 的游客行为）。
// 请求在挂载前发出，store 的 loading 会同步置位，页面不会先闪一下「空购物车」
if (useCustomerStore(pinia).isLoggedIn) {
  useCartStore(pinia).restoreFromServer()
  useFavoritesStore(pinia).restoreFromServer()
}

// 汇率/运费来自后端（exchange_rate、shipping_rate 表）：启动即拉取（先用 localStorage 缓存预热），
// 之后切换语言或后台调整都会自动重新换算价格与预估运费。
const language = useLanguageStore(pinia)
language.loadRates()
language.loadShipping()

app.mount('#app')
