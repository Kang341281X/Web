import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import App from './App.vue'
import router from './router'
import { useCartStore } from './stores/cart'
import { useCustomerStore } from './stores/customer'
import { useFavoritesStore } from './stores/favorites'
import { useLanguageStore } from './stores/language'
import './styles/main.css'
import './styles/admin.css'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.use(router)
app.use(ElementPlus, { locale: zhCn })

// 全局注册 Element Plus 图标
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}

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
