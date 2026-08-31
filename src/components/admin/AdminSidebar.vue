<script setup>
import { useAdminStore } from '../../stores/admin'
import { useExcel } from '../../composables/useExcel'

const admin = useAdminStore()
const { exportProducts, downloadTemplate } = useExcel()

function handleExport() {
  exportProducts(admin.products)
}

function handleTemplate() {
  downloadTemplate()
}
</script>

<template>
  <aside class="admin-sidebar">
    <div class="sidebar-header">
      <RouterLink to="/" class="sidebar-logo">
        <span>C</span>raftora
      </RouterLink>
      <small class="sidebar-sub">后台管理</small>
    </div>

    <nav class="sidebar-nav">
      <RouterLink to="/admin" class="sidebar-link" exact-active-class="active">
        <span class="sidebar-icon">▦</span> 仪表盘
      </RouterLink>
      <RouterLink to="/admin/products" class="sidebar-link" active-class="active">
        <span class="sidebar-icon">▤</span> 商品管理
      </RouterLink>
    </nav>

    <div class="sidebar-section">
      <h4>数据导入导出</h4>
      <button class="sidebar-btn" @click="handleExport">导出商品列表</button>
      <button class="sidebar-btn sidebar-btn-outline" @click="handleTemplate">下载导入模板</button>
    </div>

    <div class="sidebar-footer">
      <RouterLink to="/" class="back-to-site">← 返回前台</RouterLink>
    </div>
  </aside>
</template>
