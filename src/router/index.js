import { createRouter, createWebHistory } from 'vue-router'
import Home from '../views/Home.vue'
import Products from '../views/Products.vue'
import ProductDetail from '../views/ProductDetail.vue'
import Category from '../views/Category.vue'
import Search from '../views/Search.vue'
import Favorites from '../views/Favorites.vue'
import Cart from '../views/Cart.vue'
import NotFound from '../views/NotFound.vue'

export default createRouter({
  history: createWebHistory(),
  scrollBehavior: () => ({ top: 0 }),
  routes: [
    { path: '/', component: Home }, { path: '/products', component: Products },
    { path: '/product/:id', component: ProductDetail }, { path: '/category/:category', component: Category },
    { path: '/search', component: Search }, { path: '/favorites', component: Favorites },
    { path: '/cart', component: Cart }, { path: '/:pathMatch(.*)*', component: NotFound }
  ]
})
