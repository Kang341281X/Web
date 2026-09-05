<script setup>
import { onMounted, ref } from 'vue'
import { useLanguageStore } from '../../stores/language'
import { fetchSettings } from '../../services/publicApi'
const language = useLanguageStore()
const settings = ref({})

const socials = [
  { key: 'douyin', src: '/assets/images/contact/qr-douyin.svg' },
  { key: 'xiaohongshu', src: '/assets/images/contact/qr-xiaohongshu.svg' },
  { key: 'tiktok', src: '/assets/images/contact/qr-tiktok.svg' },
  { key: 'telegram', src: '/assets/images/contact/qr-telegram.svg' }
]

function qrSrc(key) {
  const qrValue = settings.value[`${key}_qr`]
  return qrValue || socials.find(s => s.key === key)?.src
}

onMounted(async () => {
  try {
    settings.value = await fetchSettings()
  } catch (error) {
    console.error('Failed to load site settings:', error)
  }
})
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
          <a v-if="settings.contact_phone" :href="`tel:${settings.contact_phone}`">{{ settings.contact_phone }}</a>
        </p>
        <p class="footer-email-label">{{ language.t('contactEmail') }}</p>
        <a v-if="settings.contact_email" :href="`mailto:${settings.contact_email}`">{{ settings.contact_email }}</a>
        <div class="footer-social-links">
          <a v-if="settings.xiaohongshu" :href="`https://www.xiaohongshu.com/user/profile/${settings.xiaohongshu}`" target="_blank" rel="noopener">{{ language.t('xiaohongshu') }}</a>
          <a v-if="settings.douyin" :href="`https://www.douyin.com/user/${settings.douyin}`" target="_blank" rel="noopener">{{ language.t('douyin') }}</a>
          <a v-if="settings.tiktok" :href="`https://www.tiktok.com/${settings.tiktok}`" target="_blank" rel="noopener">{{ language.t('tiktok') }}</a>
          <a v-if="settings.telegram" :href="settings.telegram" target="_blank" rel="noopener">{{ language.t('telegram') }}</a>
        </div>
        <div class="footer-qr-grid">
          <figure v-for="item in socials" :key="item.key">
            <img :src="qrSrc(item.key)" :alt="language.t(item.key)" width="88" height="88" />
            <figcaption>{{ language.t(item.key) }}</figcaption>
          </figure>
        </div>
      </div>
    </div>
    <div class="footer-bottom container">© 2026 {{ language.t('rights') }}</div>
  </footer>
</template>
