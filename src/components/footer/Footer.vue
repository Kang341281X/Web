<script setup>
import { useLanguageStore } from '../../stores/language'
const language = useLanguageStore()
const emails = ['support@craftora.com', 'hello@craftora.com', 'contact@craftora.com']
const socials = [
  { key: 'douyin', src: '/assets/images/contact/qr-douyin.svg' },
  { key: 'xiaohongshu', src: '/assets/images/contact/qr-xiaohongshu.svg' },
  { key: 'tiktok', src: '/assets/images/contact/qr-tiktok.svg' },
  { key: 'telegram', src: '/assets/images/contact/qr-telegram.svg' }
]
</script>
<template>
  <footer class="site-footer">
    <div class="container footer-grid">
      <div>
        <RouterLink to="/" class="logo"><span>✦</span>craftora</RouterLink>
        <p>{{ language.t('footerText') }}</p>
      </div>
      <div>
        <h4>{{ language.t('navShop') }}</h4>
        <RouterLink to="/products">{{ language.t('products') }}</RouterLink>
        <RouterLink to="/favorites">{{ language.t('favorites') }}</RouterLink>
        <RouterLink to="/cart">{{ language.t('cart') }}</RouterLink>
      </div>
      <div class="footer-contact">
        <h4>{{ language.t('contactUs') }}</h4>
        <p class="footer-phone">
          <span>{{ language.t('contactPhone') }}</span>
          <a href="tel:+864001234567">400-123-4567</a>
        </p>
        <p class="footer-email-label">{{ language.t('contactEmail') }}</p>
        <a v-for="email in emails" :key="email" :href="`mailto:${email}`">{{ email }}</a>
        <div class="footer-qr-grid">
          <figure v-for="item in socials" :key="item.key">
            <img :src="item.src" :alt="language.t(item.key)" width="88" height="88" />
            <figcaption>{{ language.t(item.key) }}</figcaption>
          </figure>
        </div>
      </div>
    </div>
    <div class="footer-bottom container">© 2026 {{ language.t('rights') }}</div>
  </footer>
</template>
