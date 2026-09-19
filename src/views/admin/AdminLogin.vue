<script setup>
import { onMounted, ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useUserStore } from '../../stores/user'
import { fetchAdminCaptcha } from '../../services/captcha'
import {
  User, Lock, View, Hide, Key
} from '@element-plus/icons-vue'

const router = useRouter()
const userStore = useUserStore()

const loginForm = reactive({
  username: localStorage.getItem('admin_saved_username') || '',
  password: '',
  captchaText: '',
  remember: !!localStorage.getItem('admin_saved_username')
})

// 图形验证码：与前台顾客登录共用后端同一套实现，只是走了 /api/captcha
const captcha = reactive({ id: '', image: '', loading: false })

async function refreshCaptcha() {
  captcha.loading = true
  loginForm.captchaText = ''
  try {
    const data = await fetchAdminCaptcha()
    captcha.id = data.captchaId
    captcha.image = data.image
  } catch {
    captcha.id = ''
    captcha.image = ''
  } finally {
    captcha.loading = false
  }
}

// 进入登录页就取一张，不必等用户点一下
onMounted(refreshCaptcha)

const rules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { min: 3, max: 20, message: '用户名长度 3-20 个字符', trigger: 'blur' }
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, max: 30, message: '密码长度 6-30 个字符', trigger: 'blur' }
  ],
  captchaText: [
    { required: true, message: '请输入验证码', trigger: 'blur' }
  ]
}

const formRef = ref(null)
const loading = ref(false)
const showPassword = ref(false)

async function handleLogin() {
  if (!formRef.value) return
  await formRef.value.validate(async (valid) => {
    if (!valid) return
    loading.value = true
    const result = await userStore.adminLogin(loginForm.username, loginForm.password, {
      captchaId: captcha.id,
      captchaText: loginForm.captchaText.trim()
    })
    loading.value = false
    if (result.success) {
      if (loginForm.remember) {
        localStorage.setItem('admin_saved_username', loginForm.username)
      } else {
        localStorage.removeItem('admin_saved_username')
      }
      ElMessage.success(`欢迎回来，${result.user.username}`)
      router.push('/admin')
    } else {
      ElMessage.error(result.message || '登录失败')
      // 验证码是一次性的，任何一次失败都已经把它作废，必须换一张再让用户重试
      refreshCaptcha()
    }
  })
}

function goHome() {
  router.push('/')
}
</script>

<template>
  <div class="login-page">
    <div class="login-container">
      <div class="login-header">
        <el-icon :size="48" color="#409eff"><User /></el-icon>
        <h1>Craftora Admin</h1>
        <p>后台管理系统</p>
      </div>

      <el-form
        ref="formRef"
        :model="loginForm"
        :rules="rules"
        size="large"
        label-position="top"
        autocomplete="on"
        @submit.prevent="handleLogin"
      >
        <el-form-item prop="username">
          <el-input
            v-model="loginForm.username"
            name="username"
            autocomplete="username"
            placeholder="请输入用户名"
            :prefix-icon="User"
            clearable
            @keyup.enter="handleLogin"
          />
        </el-form-item>

        <el-form-item prop="password">
          <el-input
            v-model="loginForm.password"
            name="password"
            autocomplete="current-password"
            :type="showPassword ? 'text' : 'password'"
            placeholder="请输入密码"
            :prefix-icon="Lock"
            @keyup.enter="handleLogin"
          >
            <template #suffix>
              <el-icon style="cursor: pointer;" @click="showPassword = !showPassword">
                <View v-if="showPassword" />
                <Hide v-else />
              </el-icon>
            </template>
          </el-input>
        </el-form-item>

        <el-form-item prop="captchaText">
          <div class="login-captcha">
            <el-input
              v-model="loginForm.captchaText"
              name="captcha"
              autocomplete="off"
              maxlength="8"
              placeholder="请输入验证码"
              :prefix-icon="Key"
              @keyup.enter="handleLogin"
            />
            <img
              v-if="captcha.image"
              class="login-captcha-image"
              :src="captcha.image"
              alt="验证码"
              title="点击换一张"
              @click="refreshCaptcha"
            />
            <el-button v-else class="login-captcha-image" :loading="captcha.loading" @click="refreshCaptcha">获取验证码</el-button>
          </div>
        </el-form-item>

        <el-form-item>
          <el-checkbox v-model="loginForm.remember">记住我</el-checkbox>
        </el-form-item>

        <el-form-item>
          <el-button
            type="primary"
            style="width: 100%;"
            :loading="loading"
            @click="handleLogin"
          >
            {{ loading ? '登录中...' : '登 录' }}
          </el-button>
        </el-form-item>
      </el-form>

      <div class="login-footer">
        <span class="login-back" @click="goHome">← 返回前台首页</span>
        <small class="login-hint">默认账号: admin / 123456</small>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}
.login-container {
  width: 400px;
  max-width: calc(100% - 32px);
  background: #fff;
  border-radius: 12px;
  padding: 40px 36px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
}
.login-header {
  text-align: center;
  margin-bottom: 32px;
}
.login-header h1 {
  font-size: 24px;
  font-weight: 700;
  color: #303030;
  margin: 12px 0 4px;
}
.login-header p {
  font-size: 14px;
  color: #909399;
  margin: 0;
}
.login-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 20px;
}
/* 图形验证码：输入框 + 可点击刷新的图片同一行 */
.login-captcha {
  display: flex;
  align-items: stretch;
  gap: 10px;
  width: 100%;
}
.login-captcha :deep(.el-input) {
  flex: 1;
  min-width: 0;
}
.login-captcha-image {
  flex: none;
  width: 118px;
  height: 40px;
  display: block;
  margin-left: 0;
  padding: 0;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  background: #f5f5f5;
  cursor: pointer;
  object-fit: cover;
}
.login-back {
  font-size: 13px;
  color: #606266;
  cursor: pointer;
  transition: color 0.2s;
}
.login-back:hover {
  color: #409eff;
}
.login-hint {
  font-size: 12px;
  color: #c0c4cc;
}

/* iOS 聚焦小于 16px 的输入框会自动放大页面：手机上把后台登录的 el-input 字号提到 16px */
@media (max-width: 760px) {
  .login-page :deep(.el-input__inner) { font-size: 16px }
}
</style>
