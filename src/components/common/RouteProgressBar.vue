<script setup>
import { useRouteProgress } from '../../composables/useRouteProgress'

// 路由切换（尤其懒加载 chunk 下载）期间的顶部进度反馈。
// 拿不到 chunk 下载的真实百分比，所以不做精确进度，而是「假装在走」的减速动画（nprogress 同款思路，纯 CSS 实现）。
const { active } = useRouteProgress()
</script>

<template>
  <!-- 不用 v-if 移除节点：靠 class 切换控制显隐，避免每次导航重新挂载导致 transition / animation 失效 -->
  <div class="route-progress" :class="{ 'route-progress--active': active }" aria-hidden="true">
    <div class="route-progress__bar"></div>
  </div>
</template>

<style scoped>
/* 页面级顶层反馈，盖过所有内容（项目内其它浮层最高 z-index 60）；
   margin-top 处理刘海 / 灵动岛机型，与 .bottom-nav 用 env(safe-area-inset-bottom) 的思路一致 */
.route-progress{position:fixed;top:0;left:0;right:0;height:3px;margin-top:env(safe-area-inset-top,0px);z-index:9999;pointer-events:none;opacity:0;transition:opacity .2s ease}
.route-progress--active{opacity:1;transition:opacity .1s ease}
.route-progress__bar{height:100%;width:0;background:var(--clay);box-shadow:0 1px 5px rgba(199,95,62,.45);transition:width .2s ease}
/* 显示期间宽度 0 → 85%：先快后慢、永远走不到头，直到导航结束整体淡出 */
.route-progress--active .route-progress__bar{animation:route-progress-advance 9s cubic-bezier(.18,.1,.15,.99) forwards}
@keyframes route-progress-advance{0%{width:0}22%{width:38%}100%{width:85%}}
@media (prefers-reduced-motion:reduce){.route-progress{transition:none}.route-progress__bar{animation:none!important;transition:none}.route-progress--active .route-progress__bar{width:85%}}
</style>