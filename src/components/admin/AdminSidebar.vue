<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Goods, DataLine, Setting, Document, User, List, Avatar, Tickets, ChatDotRound } from '@element-plus/icons-vue'
import { useUserStore } from '../../stores/user'
import api from '../../services/api'

const props = defineProps({
  collapsed: { type: Boolean, default: false },
  title: { type: String, default: 'Craftora Admin' },
})
const emit = defineEmits(['select'])

const route = useRoute()
const userStore = useUserStore()
const menuCategories = ref([])

const isSuperAdmin = computed(() => userStore.adminUser?.role === 'super_admin')
const activeMenu = computed(() => route.fullPath)

async function loadMenuCategories() {
  try {
    const { data } = await api.get('/categories')
    menuCategories.value = (data.data || []).filter(category => category.status)
  } catch {
    // 初始密码尚未修改或网络异常时，保留主菜单；页面本身会给出具体错误。
  }
}
onMounted(loadMenuCategories)
watch(() => userStore.adminUser?.must_change_password, value => { if (!value) loadMenuCategories() })
watch(() => route.fullPath, () => loadMenuCategories())
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

      <!-- 商品管理：二级菜单，子项为“全部商品”+ 各分类的“{分类名}商品信息” -->
      <el-sub-menu index="products-group">
        <template #title>
          <el-icon><Goods /></el-icon>
          <span>商品管理</span>
        </template>
        <el-menu-item index="/admin/products">全部商品</el-menu-item>
        <el-menu-item
          v-for="category in menuCategories"
          :key="category.id"
          :index="`/admin/products?category_id=${category.id}`"
        >
          {{ category.name }}商品信息
        </el-menu-item>
      </el-sub-menu>

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
