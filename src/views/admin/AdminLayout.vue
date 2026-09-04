<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessageBox, ElMessage } from 'element-plus'
import { useUserStore } from '../../stores/user'
import api from '../../services/api'
import {
  Fold, Expand, Setting, Goods, DataLine,
  ArrowDown, Back, Download, Document,
  User, SwitchButton, UserFilled
} from '@element-plus/icons-vue'

const userStore = useUserStore()
const router = useRouter()
const route = useRoute()
const menuCategories = ref([])

const isCollapsed = ref(false)
const isMobile = ref(false)
const mobileDrawerVisible = ref(false)

// 检测移动端
function checkMobile() {
  isMobile.value = window.innerWidth <= 768
}
checkMobile()
window.addEventListener('resize', checkMobile)

function toggleSidebar() {
  if (isMobile.value) {
    mobileDrawerVisible.value = !mobileDrawerVisible.value
  } else {
    isCollapsed.value = !isCollapsed.value
  }
}

// 当前激活菜单
const activeMenu = computed(() => route.fullPath)

// 面包屑
const breadcrumb = computed(() => {
  if (route.path === '/admin') return ['首页', '仪表盘']
  if (route.path === '/admin/products') return ['首页', '商品管理']
  if (route.path === '/admin/categories') return ['首页', '商品分类']
  if (route.path === '/admin/settings') return ['首页', '系统设置']
  if (route.path === '/admin/admins') return ['首页', '管理员信息']
  if (route.path === '/admin/profile') return ['个人中心']
  return ['首页']
})

// 用户下拉菜单
function handleUserCommand(command) {
  if (command === 'logout') {
    ElMessageBox.confirm('确认退出登录吗？', '提示', {
      type: 'warning'
    }).then(() => {
      userStore.adminLogout()
      ElMessage.success('已退出登录')
      router.push('/admin/login')
    }).catch(() => {})
  } else if (command === 'profile') {
    router.push('/admin/profile')
  }
}

// 菜单选择
function handleMenuSelect(index) {
  router.push(index)
  if (isMobile.value) mobileDrawerVisible.value = false
}

async function loadMenuCategories() {
  try {
    const { data } = await api.get('/categories')
    menuCategories.value = data.data.filter(category => category.status)
  } catch {
    // 初始密码尚未修改或网络异常时，保留主菜单；页面本身会给出具体错误。
  }
}
onMounted(loadMenuCategories)
watch(() => userStore.adminUser?.must_change_password, value => { if (!value) loadMenuCategories() })
watch(() => route.fullPath, () => loadMenuCategories())
</script>
<template>
  <div class="admin-layout">
    <!-- 移动端遮罩 -->
    <el-drawer
      v-if="isMobile"
      v-model="mobileDrawerVisible"
      direction="ltr"
      :with-header="false"
      :size="210"
    >
      <div class="admin-aside" style="width: 210px;">
        <div class="admin-aside-logo">
          <el-icon class="logo-icon"><Goods /></el-icon>
          <span>Craftora</span>
        </div>
        <el-menu
          :default-active="activeMenu"
          background-color="transparent"
          text-color="rgba(255,255,255,0.65)"
          active-text-color="#fff"
          @select="handleMenuSelect"
        >
          <el-menu-item index="/admin">
            <el-icon><DataLine /></el-icon>
            <span>仪表盘</span>
          </el-menu-item>
          <el-sub-menu index="/admin/products-group">
            <template #title>
              <el-icon><Goods /></el-icon>
              <span>商品管理</span>
            </template>
            <el-menu-item index="/admin/products">全部商品</el-menu-item>
            <el-menu-item v-for="category in menuCategories" :key="category.id" :index="`/admin/products?category_id=${category.id}`">{{ category.name }}商品信息</el-menu-item>
          </el-sub-menu>
          <el-menu-item index="/admin/categories"><el-icon><Document /></el-icon><span>商品分类</span></el-menu-item>
          <el-menu-item index="/admin/settings">
            <el-icon><Setting /></el-icon>
            <span>系统设置</span>
          </el-menu-item>
          <el-menu-item v-if="userStore.adminUser?.role === 'super_admin'" index="/admin/admins">
            <el-icon><User /></el-icon>
            <span>管理员信息</span>
          </el-menu-item>
        </el-menu>
      </div>
    </el-drawer>

    <!-- 桌面端侧边栏 -->
    <aside v-if="!isMobile" class="admin-aside" :class="{ 'admin-aside--collapsed': isCollapsed }" :style="{ width: isCollapsed ? '64px' : '210px' }">
      <div class="admin-aside-logo">
        <el-icon class="logo-icon"><Goods /></el-icon>
        <span>Craftora Admin</span>
      </div>
      <el-menu
        :default-active="activeMenu"
        background-color="transparent"
        text-color="rgba(255,255,255,0.65)"
        active-text-color="#fff"
        :collapse="isCollapsed"
        @select="handleMenuSelect"
      >
        <el-menu-item index="/admin">
          <el-icon><DataLine /></el-icon>
          <template #title>仪表盘</template>
        </el-menu-item>
        <el-sub-menu index="/admin/products-group">
          <template #title>
            <el-icon><Goods /></el-icon>
            <span>商品管理</span>
          </template>
          <el-menu-item index="/admin/products">全部商品</el-menu-item>
          <el-menu-item v-for="category in menuCategories" :key="category.id" :index="`/admin/products?category_id=${category.id}`">{{ category.name }}商品信息</el-menu-item>
        </el-sub-menu>
        <el-menu-item index="/admin/categories"><el-icon><Document /></el-icon><template #title>商品分类</template></el-menu-item>
        <el-menu-item index="/admin/settings">
          <el-icon><Setting /></el-icon>
          <template #title>系统设置</template>
        </el-menu-item>
        <el-menu-item v-if="userStore.adminUser?.role === 'super_admin'" index="/admin/admins">
          <el-icon><User /></el-icon>
          <template #title>管理员信息</template>
        </el-menu-item>
      </el-menu>
    </aside>

    <!-- 右侧内容区 -->
    <el-container class="admin-container">
      <!-- 顶部导航栏 -->
      <el-header class="admin-header">
        <div class="admin-header-left">
          <span class="admin-header-trigger" @click="toggleSidebar">
            <el-icon :size="20"><Fold v-if="!isCollapsed && !isMobile" /><Expand v-else /></el-icon>
          </span>
          <el-breadcrumb separator="/" class="admin-header-breadcrumb">
            <el-breadcrumb-item v-for="(crumb, i) in breadcrumb" :key="i" :to="i === 0 ? '/' : undefined">
              {{ crumb }}
            </el-breadcrumb-item>
          </el-breadcrumb>
        </div>
        <div class="admin-header-right">
          <el-tooltip content="返回前台" placement="bottom">
            <span class="admin-header-icon" @click="router.push('/')">
              <el-icon><Back /></el-icon>
            </span>
          </el-tooltip>
          <el-dropdown @command="handleUserCommand">
            <span class="admin-user-trigger">
              <el-avatar :size="32" :src="userStore.adminUser?.avatar_url || '/assets/images/avatars/avatar-placeholder.svg'" :icon="UserFilled" />
              <span class="admin-user-name">{{ userStore.adminUser?.username || '管理员' }}</span>
              <el-icon><ArrowDown /></el-icon>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="profile" :icon="User">个人中心</el-dropdown-item>
                <el-dropdown-item command="logout" :icon="SwitchButton" divided>退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>

      <!-- 主内容 -->
      <el-main class="admin-main">
        <RouterView />
      </el-main>
    </el-container>
  </div>
</template>

