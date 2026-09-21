import { watchEffect } from 'vue'

const SUFFIX = ' · Craftora'

/**
 * 设置 document.title 的组合式函数：传入一个响应式取值函数（computed / ref / getter），
 * 当取值变化或当前组件内任意依赖变化时，自动把 title 同步为「取值 · Craftora」。
 * 空值/假值会被忽略（保留之前的 title），保证 SSR 与初次渲染不会闪成「undefined · Craftora」。
 *
 * 调用方负责传入的 getter 在 deps 改变时返回新值，watchEffect 会自动追踪；
 * 因此路由切换 + 语言切换时只需让 getter 自身依赖 route / language.locale 即可，无需手动指定 sources。
 *
 * 用例：商品详情页用 useI18nTitle(() => title.value)，分类页用 useI18nTitle(() => categoryName.value)。
 * App.vue 在静态路由上单独使用同一组策略，避免两处互相覆盖——以 /product/ 与 /category/ 为分割线。
 */
export function useI18nTitle(getTitle) {
  watchEffect(() => {
    const value = typeof getTitle === 'function' ? getTitle() : getTitle?.value
    if (value) document.title = `${value}${SUFFIX}`
  })
}