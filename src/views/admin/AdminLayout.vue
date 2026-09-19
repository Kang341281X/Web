<script setup>
import { ref, computed, onBeforeUnmount } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessageBox, ElMessage } from 'element-plus'
import { useUserStore } from '../../stores/user'
import { Fold, Expand, Back, ArrowDown, User, SwitchButton, UserFilled } from '@element-plus/icons-vue'
import AdminSidebar from '../../components/admin/AdminSidebar.vue'
import { resolve } from '../../utils/image'

const userStore = useUserStore()
const router = useRouter()
const route = useRoute()

const isCollapsed = ref(false)
const isMobile = ref(false)
const mobileDrawerVisible = ref(false)

// 检测移动端
function checkMobile() {
  isMobile.value = window.innerWidth <= 768
}
checkMobile()
window.addEventListener('resize', checkMobile)
onBeforeUnmount(() => window.removeEventListener('resize', checkMobile))

function toggleSidebar() {
  if (isMobile.value) {
    mobileDrawerVisible.value = !mobileDrawerVisible.value
  } else {
    isCollapsed.value = !isCollapsed.value
  }
}

// 面包屑
const breadcrumb = computed(() => {
  if (route.path === '/admin') return ['首页', '仪表盘']
  if (route.path === '/admin/products') return ['首页', '商品管理']
  if (route.path === '/admin/categories') return ['首页', '商品分类']
  if (route.path === '/admin/reviews') return ['首页', '商品管理', '商品评论']
  if (route.path === '/admin/orders') return ['首页', '订单管理']
  if (route.path === '/admin/customers') return ['首页', '用户管理']
  if (route.path === '/admin/settings') return ['首页', '其他设置']
  if (route.path === '/admin/logs') return ['首页', '操作日志']
  if (route.path === '/admin/admins') return ['首页', '管理员信息']
  if (route.path === '/admin/finance') return ['首页', '收支明细']
  if (route.path === '/admin/profile') return ['个人中心']
  return ['首页']
})

// 用户下拉菜单（个人中心 / 退出登录）
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
</script>
<template>
  <div class="admin-layout">
    <!-- 移动端遮罩抽屉 -->
    <el-drawer
      v-if="isMobile"
      v-model="mobileDrawerVisible"
      direction="ltr"
      :with-header="false"
      :size="210"
    >
      <AdminSidebar title="Craftora" :collapsed="false" @select="handleMenuSelect" />
    </el-drawer>

    <!-- 桌面端侧边栏 -->
    <AdminSidebar v-if="!isMobile" :collapsed="isCollapsed" @select="handleMenuSelect" />

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
              <el-avatar :size="32" :src="resolve(userStore.adminUser?.avatar_url)" :icon="UserFilled" />
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
        <!-- 小屏提示：仅移动端渲染（isMobile），表格列多需横滚 -->
        <div v-if="isMobile" class="admin-mobile-hint">当前屏幕较窄，数据表格需左右滑动查看，建议横屏或使用电脑访问后台。</div>
        <RouterView />
      </el-main>
    </el-container>
  </div>
</template>
