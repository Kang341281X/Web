<script setup>
import { ref, reactive } from 'vue'
import { ElMessage, ElNotification, ElMessageBox } from 'element-plus'
import {
  Check, Refresh
} from '@element-plus/icons-vue'

const settingsRef = ref(null)

const settingsForm = reactive({
  siteName: 'Craftora 手作集市',
  siteDesc: '发现手作的温度与灵感',
  adminEmail: 'admin@craftora.com',
  category: 'ceramics',
  status: 'online',
  maintenanceMode: false,
  allowRegister: true,
  showInventory: true,
  createdAt: [new Date(2025, 0, 15), new Date()],
  priceRange: [0, 1000],
  theme: 'blue'
})

const rules = {
  siteName: [
    { required: true, message: '请输入站点名称', trigger: 'blur' },
    { min: 2, max: 30, message: '长度 2-30 个字符', trigger: 'blur' }
  ],
  adminEmail: [
    { required: true, message: '请输入管理员邮箱', trigger: 'blur' },
    { type: 'email', message: '请输入正确的邮箱格式', trigger: 'blur' }
  ]
}

// 主题颜色选项
const themeOptions = [
  { label: '经典蓝', value: 'blue', color: '#409eff' },
  { label: '活力橙', value: 'orange', color: '#e6a23c' },
  { label: '自然绿', value: 'green', color: '#67c23a' },
  { label: '热情红', value: 'red', color: '#f56c6c' },
  { label: '优雅紫', value: 'purple', color: '#a856ff' }
]

const statusOptions = [
  { label: '在线运营', value: 'online' },
  { label: '测试模式', value: 'testing' },
  { label: '维护模式', value: 'maintenance' }
]

function changeTheme(val) {
  const theme = themeOptions.find(t => t.value === val)
  if (!theme) return
  document.documentElement.style.setProperty('--el-color-primary', theme.color)
  document.documentElement.style.setProperty('--el-color-primary-light-3', theme.color + '99')
  document.documentElement.style.setProperty('--el-color-primary-light-5', theme.color + '66')
  document.documentElement.style.setProperty('--el-color-primary-light-7', theme.color + '44')
  document.documentElement.style.setProperty('--el-color-primary-light-9', theme.color + '11')
  ElMessage.success(`主题已切换为：${theme.label}`)
}

async function handleSave() {
  if (!settingsRef.value) return
  await settingsRef.value.validate(async (valid) => {
    if (!valid) {
      ElMessage.warning('请完成表单验证')
      return
    }
    ElNotification.success({
      title: '保存成功',
      message: '系统设置已更新并生效',
      duration: 3000
    })
  })
}

function handleReset() {
  ElMessageBox.confirm('确认重置所有设置到默认值吗？', '重置确认', {
    type: 'warning'
  }).then(() => {
    Object.assign(settingsForm, {
      siteName: 'Craftora 手作集市',
      siteDesc: '发现手作的温度与灵感',
      adminEmail: 'admin@craftora.com',
      category: 'ceramics',
      status: 'online',
      maintenanceMode: false,
      allowRegister: true,
      showInventory: true,
      createdAt: [new Date(2025, 0, 15), new Date()],
      priceRange: [0, 1000],
      theme: 'blue'
    })
    changeTheme('blue')
    ElMessage.success('设置已重置')
  }).catch(() => {})
}

const shortcuts = [
  { text: '最近一周', value: () => { const e = new Date(); const s = new Date(); s.setTime(s.getTime() - 7*86400000); return [s, e] } },
  { text: '最近一个月', value: () => { const e = new Date(); const s = new Date(); s.setMonth(s.getMonth() - 1); return [s, e] } },
  { text: '最近三个月', value: () => { const e = new Date(); const s = new Date(); s.setMonth(s.getMonth() - 3); return [s, e] } }
]
</script>

<template>
  <div class="admin-form-page">
    <el-card shadow="never">
      <template #header>
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-weight: 600;">系统设置</span>
          <el-button :icon="Refresh" text @click="handleReset">重置</el-button>
        </div>
      </template>

      <el-form
        ref="settingsRef"
        :model="settingsForm"
        :rules="rules"
        label-width="120px"
        label-position="right"
      >
        <!-- 基本信息 -->
        <el-divider content-position="left">基本信息</el-divider>

        <el-form-item label="站点名称" prop="siteName">
          <el-input v-model="settingsForm.siteName" placeholder="请输入站点名称" style="max-width: 400px;" />
        </el-form-item>

        <el-form-item label="站点描述">
          <el-input
            v-model="settingsForm.siteDesc"
            type="textarea"
            :rows="2"
            placeholder="请输入站点描述"
            style="max-width: 400px;"
          />
        </el-form-item>

        <el-form-item label="管理员邮箱" prop="adminEmail">
          <el-input v-model="settingsForm.adminEmail" placeholder="请输入管理员邮箱" style="max-width: 400px;" />
        </el-form-item>

        <el-form-item label="运营时段">
          <el-date-picker
            v-model="settingsForm.createdAt"
            type="daterange"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            :shortcuts="shortcuts"
            style="max-width: 400px;"
          />
        </el-form-item>

        <!-- 运营设置 -->
        <el-divider content-position="left">运营设置</el-divider>

        <el-form-item label="默认分类">
          <el-select v-model="settingsForm.category" placeholder="请选择" style="max-width: 300px;">
            <el-option label="ceramics" value="ceramics" />
            <el-option label="jewelry" value="jewelry" />
            <el-option label="home" value="home" />
            <el-option label="woodwork" value="woodwork" />
            <el-option label="textile" value="textile" />
            <el-option label="art" value="art" />
            <el-option label="gifts" value="gifts" />
          </el-select>
        </el-form-item>

        <el-form-item label="运营状态">
          <el-select v-model="settingsForm.status" style="max-width: 200px;">
            <el-option
              v-for="opt in statusOptions"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="价格区间">
          <el-slider
            v-model="settingsForm.priceRange"
            range
            :max="2000"
            :step="10"
            style="max-width: 400px;"
          />
        </el-form-item>

        <el-form-item label="允许注册">
          <el-switch v-model="settingsForm.allowRegister" active-text="开放" inactive-text="关闭" />
        </el-form-item>

        <el-form-item label="显示库存">
          <el-switch v-model="settingsForm.showInventory" active-text="显示" inactive-text="隐藏" />
        </el-form-item>

        <el-form-item label="维护模式">
          <el-switch v-model="settingsForm.maintenanceMode" active-text="开启" inactive-text="关闭" />
          <span style="margin-left: 12px; color: #909399; font-size: 12px;">
            开启后前台将显示维护页面
          </span>
        </el-form-item>

        <!-- 主题定制 -->
        <el-divider content-position="left">主题定制</el-divider>

        <el-form-item label="主色调">
          <el-radio-group v-model="settingsForm.theme" @change="changeTheme">
            <el-radio-button v-for="t in themeOptions" :key="t.value" :value="t.value">
              <span :style="{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', background: t.color, marginRight: '4px' }" />
              {{ t.label }}
            </el-radio-button>
          </el-radio-group>
        </el-form-item>

        <!-- 操作按钮 -->
        <el-form-item>
          <el-button type="primary" :icon="Check" @click="handleSave">保存设置</el-button>
          <el-button @click="handleReset">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>
