<script setup>
import { ref, watch, onBeforeUnmount, nextTick } from 'vue'
import Cropper from 'cropperjs'
import { ElMessage } from 'element-plus'

const props = defineProps({
  visible: Boolean,
  src: { type: String, default: '' },
  // 是否为已上传图片（有 image_id），决定裁剪后走替换流程还是返回 blob
  imageId: { type: [Number, String], default: null },
  productId: { type: [Number, String], default: null },
})

const emit = defineEmits(['update:visible', 'cropped'])

const dialogVisible = ref(props.visible)
const imageEl = ref(null)
let cropper = null
const cropData = ref({ width: 0, height: 0, x: 0, y: 0 })
const originalSize = ref({ width: 0, height: 0 })
const saving = ref(false)

watch(() => props.visible, val => {
  dialogVisible.value = val
  if (val && props.src) {
    nextTick(initCropper)
  } else {
    destroyCropper()
  }
})
watch(dialogVisible, val => emit('update:visible', val))

function initCropper() {
  destroyCropper()
  if (!imageEl.value) return
  // 加载图片获取原始分辨率
  const tempImg = new Image()
  tempImg.onload = () => {
    originalSize.value = { width: tempImg.naturalWidth, height: tempImg.naturalHeight }
  }
  tempImg.src = props.src
  cropper = new Cropper(imageEl.value, {
    viewMode: 1,
    autoCropArea: 0.8,
    background: false,
    movable: true,
    zoomable: true,
    rotatable: false,
    scalable: false,
    crop(e) {
      cropData.value = {
        width: Math.round(e.detail.width),
        height: Math.round(e.detail.height),
        x: Math.round(e.detail.x),
        y: Math.round(e.detail.y),
      }
    },
  })
}

function destroyCropper() {
  if (cropper) { cropper.destroy(); cropper = null }
}

function resetCrop() {
  if (cropper) cropper.reset()
}

async function handleConfirm() {
  if (!cropper) return
  saving.value = true
  try {
    const canvas = cropper.getCroppedCanvas({
      imageSmoothingQuality: 'high',
      maxWidth: 2000,
      maxHeight: 2000,
    })
    if (!canvas) { ElMessage.error('裁剪失败，请重试'); return }
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92))
    if (!blob) { ElMessage.error('生成图片失败'); return }

    // 如果是已上传图片，直接调用替换接口
    if (props.imageId) {
      const formData = new FormData()
      formData.append('image', blob, 'cropped.jpg')
      // 使用 api 替换图片
      const { default: api } = await import('../../services/api')
      const { data } = await api.post(`/products/images/${props.imageId}/replace`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      ElMessage.success('裁剪已应用')
      emit('cropped', { imageId: props.imageId, data: data.data })
    } else {
      // 新图片，返回 blob 供父组件处理
      emit('cropped', { blob, url: URL.createObjectURL(blob) })
    }
    dialogVisible.value = false
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '裁剪失败')
  } finally {
    saving.value = false
  }
}

onBeforeUnmount(destroyCropper)
</script>

<template>
  <el-dialog v-model="dialogVisible" title="预览与裁剪" width="min(1100px, calc(100% - 32px))" top="2vh" destroy-on-close @closed="destroyCropper">
    <div class="crop-layout">
      <div class="crop-canvas-wrap">
        <img ref="imageEl" :src="src" class="crop-source-img" />
      </div>
      <div class="crop-sidebar">
        <div class="crop-info">
          <div class="crop-info-title">原始图片</div>
          <div class="crop-info-row"><span>分辨率</span><strong>{{ originalSize.width }} × {{ originalSize.height }}px</strong></div>
          <div class="crop-info-divider"></div>
          <div class="crop-info-title">裁剪区域</div>
          <div class="crop-info-row"><span>裁剪宽度</span><strong>{{ cropData.width }}px</strong></div>
          <div class="crop-info-row"><span>裁剪高度</span><strong>{{ cropData.height }}px</strong></div>
          <div class="crop-info-row"><span>X 偏移</span>{{ cropData.x }}px</div>
          <div class="crop-info-row"><span>Y 偏移</span>{{ cropData.y }}px</div>
        </div>
        <el-button size="small" @click="resetCrop">重置裁剪框</el-button>
      </div>
    </div>
    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="handleConfirm">应用裁剪</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.crop-layout { display: flex; gap: 16px; align-items: flex-start }
.crop-canvas-wrap { flex: 1; min-width: 0; max-height: 75vh; overflow: hidden; border: 1px solid #e4e7ed; border-radius: 4px; background: #f5f7fa }
.crop-source-img { max-width: 100%; display: block }
.crop-sidebar { width: 200px; flex-shrink: 0; display: flex; flex-direction: column; gap: 12px }
.crop-info { background: #f5f7fa; border-radius: 6px; padding: 14px }
.crop-info-title { font-size: 12px; color: #909399; margin-bottom: 8px; font-weight: 600; text-transform: uppercase; letter-spacing: .5px }
.crop-info-divider { height: 1px; background: #dcdfe6; margin: 12px 0 }
.crop-info-row { display: flex; justify-content: space-between; align-items: center; font-size: 13px; color: #606266; margin-bottom: 6px }
.crop-info-row:last-child { margin-bottom: 0 }
.crop-info-row strong { color: #303133; font-size: 14px }
@media (max-width: 768px) {
  .crop-layout { flex-direction: column }
  .crop-sidebar { width: 100%; flex-direction: row; align-items: center; justify-content: space-between }
}
</style>
