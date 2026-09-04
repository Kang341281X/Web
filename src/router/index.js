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
import AdminLayout from '../views/admin/AdminLayout.vue'
import AdminDashboard from '../views/admin/AdminDashboard.vue'
import AdminProducts from '../views/admin/AdminProducts.vue'
import AdminSettings from '../views/admin/AdminSettings.vue'
import AdminLogin from '../views/admin/AdminLogin.vue'
import AdminUsers from '../views/admin/AdminUsers.vue'
import AdminProfile from '../views/admin/AdminProfile.vue'

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
    { path: '/admin/login', component: AdminLogin, meta: { guestOnly: true } },
    {
      path: '/admin',
      component: AdminLayout,
      meta: { requiresAuth: true },
      children: [
        { path: '', component: AdminDashboard },
        { path: 'products', component: AdminProducts },
        { path: 'settings', component: AdminSettings },
        { path: 'profile', component: AdminProfile },
        { path: 'admins', component: AdminUsers, meta: { requiresSuperAdmin: true } }
      ]
    },
    { path: '/:pathMatch(.*)*', component: NotFound }
  ]
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
