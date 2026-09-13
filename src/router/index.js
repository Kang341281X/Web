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
    // 前台顾客路由：登录态在页面内部判断（见 views/Account.vue），不用 admin 的 requiresAuth。
    // 页面依赖裁剪组件（cropperjs），单独分包，不增加前台首屏体积。
    { path: '/account', component: () => import('../views/Account.vue') },
    // 收货地址管理：个人中心的子模块，同样在页面内部判断登录态
    { path: '/account/addresses', component: () => import('../views/AddressList.vue') },
    // 我的订单：Header / 抽屉 / 个人中心入口指向此路由，登录态同样在页面内部判断
    { path: '/orders', component: () => import('../views/Orders.vue') },
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
        // 商品评论：商品管理下的二级菜单，对应 /api/admin-reviews
        {
          path: 'reviews',
          component: () => import('../views/admin/AdminReviews.vue'),
        },
        // 用户管理 / 订单管理：对应阶段 6 的 /api/admin-customers 与 /api/admin-orders
        {
          path: 'customers',
          component: () => import('../views/admin/AdminCustomers.vue'),
        },
        {
          path: 'orders',
          component: () => import('../views/admin/AdminOrders.vue'),
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
        // 收支明细：仅超级管理员，与后端 /api/admin/finance 的 requireSuperAdmin 对应
        {
          path: 'finance',
          component: () => import('../views/admin/AdminFinance.vue'),
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
