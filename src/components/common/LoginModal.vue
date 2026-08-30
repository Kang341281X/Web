<script setup>
import { useUserStore } from '../../stores/user'
import { useLanguageStore } from '../../stores/language'
const user = useUserStore(); const language = useLanguageStore()
const login = () => { user.name = 'Craftora 朋友'; user.closeLogin() }
</script>
<template>
  <Teleport to="body"><div v-if="user.isLoginOpen" class="modal-backdrop" @click.self="user.closeLogin()"><section class="login-modal" role="dialog" aria-modal="true"><button class="icon-button modal-close" :aria-label="language.t('close')" @click="user.closeLogin()">×</button><span class="eyebrow">CRAFTORA</span><h2>{{ language.t('welcome') }}</h2><p>{{ language.t('loginText') }}</p><label>{{ language.t('email') }}<input type="email" placeholder="hello@craftora.com" /></label><label>{{ language.t('password') }}<input type="password" placeholder="••••••••" /></label><button class="button primary wide" @click="login">{{ language.t('signIn') }}</button></section></div></Teleport>
</template>
