<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { Goods, DataLine, Setting, Document, User, List, Avatar, Tickets, ChatDotRound, Money, Download } from '@element-plus/icons-vue'
import { useUserStore } from '../../stores/user'

const props = defineProps({
  collapsed: { type: Boolean, default: false },
  title: { type: String, default: 'Craftora Admin' },
})
const emit = defineEmits(['select'])

const route = useRoute()
const userStore = useUserStore()

const isSuperAdmin = computed(() => userStore.adminUser?.role === 'super_admin')
// 菜单全部是一级路径，按 path 高亮，避免链接带上查询参数（如 ?category_id=）时菜单失去选中态
const activeMenu = computed(() => route.path)
</script>

<template>
  <div class="admin-aside" :class="{ 'admin-aside--collapsed': props.collapsed }" :style="{ width: props.collapsed ? '64px' : '210px' }">
    <div class="admin-aside-logo">
      <el-icon class="logo-icon"><Goods /></el-icon>
      <span v-if="!props.collapsed">{{ props.title }}</span>
    </div>
    <el-menu
      :default-active="activeMenu"
      background-color="transparent"
      text-color="rgba(255,255,255,0.78)"
      active-text-color="#fff"
      :collapse="props.collapsed"
      :collapse-transition="false"
      @select="index => emit('select', index)"
    >
      <el-menu-item index="/admin">
        <el-icon><DataLine /></el-icon>
        <template #title>仪表盘</template>
      </el-menu-item>

      <el-menu-item v-if="isSuperAdmin" index="/admin/admins">
        <el-icon><User /></el-icon>
        <template #title>管理员信息</template>
      </el-menu-item>

      <!-- 商品管理：一级菜单，点击直接进入全部商品列表 -->
      <el-menu-item index="/admin/products">
        <el-icon><Goods /></el-icon>
        <template #title>商品管理</template>
      </el-menu-item>

      <el-menu-item index="/admin/customers">
        <el-icon><Avatar /></el-icon>
        <template #title>用户管理</template>
      </el-menu-item>

      <el-menu-item index="/admin/categories">
        <el-icon><Document /></el-icon>
        <template #title>商品分类</template>
      </el-menu-item>

      <el-menu-item index="/admin/orders">
        <el-icon><Tickets /></el-icon>
        <template #title>订单管理</template>
      </el-menu-item>

      <!-- 访客下载记录：未登录访客下载结算清单产生的只读记录，与顾客正式订单是两套数据 -->
      <el-menu-item index="/admin/intent-orders">
        <el-icon><Download /></el-icon>
        <template #title>访客下载记录</template>
      </el-menu-item>

      <!-- 收支明细：仅超级管理员可见（后端同样按 super_admin 拦截） -->
      <el-menu-item v-if="isSuperAdmin" index="/admin/finance">
        <el-icon><Money /></el-icon>
        <template #title>收支明细</template>
      </el-menu-item>

      <!-- 商品评论：从「商品管理」的二级子菜单提升为一级菜单，紧跟订单管理 -->
      <el-menu-item index="/admin/reviews">
        <el-icon><ChatDotRound /></el-icon>
        <template #title>商品评论</template>
      </el-menu-item>

      <el-menu-item index="/admin/logs">
        <el-icon><List /></el-icon>
        <template #title>操作日志</template>
      </el-menu-item>

      <el-menu-item index="/admin/settings">
        <el-icon><Setting /></el-icon>
        <template #title>其他设置</template>
      </el-menu-item>
    </el-menu>
  </div>
</template>
