<script setup>
import { computed, onMounted, ref } from 'vue'
import { useLanguageStore } from '../../stores/language'
import { fetchSettings } from '../../services/publicApi'
import AppImage from '../common/AppImage.vue'
const language = useLanguageStore()
const settings = ref({})

// 社交平台未上传二维码时默认显示统一占位图，不再隐藏
const socialItems = computed(() => settings.value.social_media || [])

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
          <a v-if="settings.contact_phone2" :href="`tel:${settings.contact_phone2}`">{{ settings.contact_phone2 }}</a>
        </p>
        <p class="footer-phone">
          <span>{{ language.t('contactEmail') }}</span>
          <a v-if="settings.contact_email" :href="`mailto:${settings.contact_email}`">{{ settings.contact_email }}</a>
          <a v-if="settings.contact_email2" :href="`mailto:${settings.contact_email2}`">{{ settings.contact_email2 }}</a>
        </p>
        <p v-if="socialItems.length" class="footer-phone">
          <span>{{ language.t('streaming') }}</span>
        </p>
        <div v-if="socialItems.length" class="footer-qr-grid">
          <figure v-for="item in socialItems" :key="item.id">
            <AppImage :src="item.image_url" :alt="item.name" width="88" height="88" />
            <figcaption>{{ item.name }}</figcaption>
          </figure>
        </div>
      </div>
    </div>
    <div class="footer-bottom container">© 2026 {{ language.t('rights') }}</div>
  </footer>
</template>
