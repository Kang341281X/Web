import { createRouter, createWebHistory } from 'vue-router'
import { useUserStore } from '../stores/user'
import Home from '../views/Home.vue'
import Products from '../views/Products.vue'
import ProductDetail from '../views/ProductDetail.vue'
import Category from '../views/Category.vue'
import Search from '../views/Search.vue'
import Favorites from '../views/Favorites.vue'
import Cart from '../views/Cart.vue'
import NotFound from '../views/NotFound.vue'

// /admin 下的后台管理页面全部动态 import（路由级代码分割），
// echarts 在 AdminDashboard 中同样动态引入，减小前台首屏包体。
const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: () => ({ top: 0 }),
  routes: [
    { path: '/', component: Home },
    { path: '/products', component: Products },
    { path: '/product/:id', component: ProductDetail },
    { path: '/category/:category', component: Category },
    { path: '/search', component: Search },
    { path: '/favorites', component: Favorites },
    { path: '/cart', component: Cart },
    {
      path: '/admin/login',
      component: () => import('../views/admin/AdminLogin.vue'),
      meta: { guestOnly: true },
    },
    {
      path: '/admin',
      component: () => import('../views/admin/AdminLayout.vue'),
      meta: { requiresAuth: true },
      children: [
        {
          path: '',
          component: () => import('../views/admin/AdminDashboard.vue'),
        },
        {
          path: 'products',
          component: () => import('../views/admin/AdminProducts.vue'),
        },
        {
          path: 'categories',
          component: () => import('../views/admin/AdminCategories.vue'),
        },
        // settings/logs 对普通管理员可见，仅 admins 仍限 super_admin
        {
          path: 'settings',
          component: () => import('../views/admin/AdminSettings.vue'),
        },
        {
          path: 'logs',
          component: () => import('../views/admin/AdminLogs.vue'),
        },
        {
          path: 'profile',
          component: () => import('../views/admin/AdminProfile.vue'),
        },
        {
          path: 'admins',
          component: () => import('../views/admin/AdminUsers.vue'),
          meta: { requiresSuperAdmin: true },
        },
      ],
    },
    { path: '/:pathMatch(.*)*', component: NotFound },
  ],
})

// 路由守卫：后台管理需要登录
router.beforeEach((to, from, next) => {
  const userStore = useUserStore()
  // 需要登录但未登录 → 跳转登录页
  if (to.meta.requiresAuth && !userStore.isAdmin) {
    return next('/admin/login')
  }
  if (to.meta.requiresSuperAdmin && userStore.adminUser?.role !== 'super_admin') {
    return next('/admin')
  }
  // 已登录用户访问登录页 → 跳转后台
  if (to.meta.guestOnly && userStore.isAdmin) {
    return next('/admin')
  }
  next()
})

export default router
