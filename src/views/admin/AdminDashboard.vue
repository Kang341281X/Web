<script setup>
import { computed } from 'vue'
import { useAdminStore } from '../../stores/admin'
import { categories } from '../../data/categories'
import {
  Goods, Files, Box, Money
} from '@element-plus/icons-vue'

const admin = useAdminStore()
const stats = computed(() => admin.stats)

const categoryBreakdown = computed(() => {
  const map = {}
  admin.products.forEach(p => {
    map[p.category] = (map[p.category] || 0) + 1
  })
  return Object.entries(map).sort((a, b) => b[1] - a[1])
})

const maxCount = computed(() => {
  return Math.max(...categoryBreakdown.value.map(([_, c]) => c), 1)
})

const recentProducts = computed(() => [...admin.products].slice(0, 6))
</script>

<template>
  <div>
    <!-- 统计卡片 -->
    <div class="dashboard-stat-grid">
      <el-card shadow="hover" body-style="padding: 20px;">
        <div class="dashboard-stat-card">
          <div class="dashboard-stat-icon dashboard-stat-icon--blue">
            <el-icon :size="28"><Goods /></el-icon>
          </div>
          <div>
            <div class="dashboard-stat-value">{{ stats.total }}</div>
            <div class="dashboard-stat-label">商品总数</div>
          </div>
        </div>
      </el-card>
      <el-card shadow="hover" body-style="padding: 20px;">
        <div class="dashboard-stat-card">
          <div class="dashboard-stat-icon dashboard-stat-icon--green">
            <el-icon :size="28"><Files /></el-icon>
          </div>
          <div>
            <div class="dashboard-stat-value">{{ stats.categories }}</div>
            <div class="dashboard-stat-label">分类数</div>
          </div>
        </div>
      </el-card>
      <el-card shadow="hover" body-style="padding: 20px;">
        <div class="dashboard-stat-card">
          <div class="dashboard-stat-icon dashboard-stat-icon--orange">
            <el-icon :size="28"><Box /></el-icon>
          </div>
          <div>
            <div class="dashboard-stat-value">{{ stats.totalStock }}</div>
            <div class="dashboard-stat-label">总库存</div>
          </div>
        </div>
      </el-card>
      <el-card shadow="hover" body-style="padding: 20px;">
        <div class="dashboard-stat-card">
          <div class="dashboard-stat-icon dashboard-stat-icon--red">
            <el-icon :size="28"><Money /></el-icon>
          </div>
          <div>
            <div class="dashboard-stat-value">{{ stats.totalSales }}</div>
            <div class="dashboard-stat-label">总销量</div>
          </div>
        </div>
      </el-card>
    </div>

    <!-- 分类分布 + 最近商品 -->
    <el-row :gutter="20">
      <el-col :xs="24" :md="12">
        <el-card shadow="never" header="分类分布" class="admin-page-card">
          <div class="category-progress-list">
            <div v-for="([cat, count]) in categoryBreakdown" :key="cat" class="category-progress-item">
              <span class="category-progress-name">
                {{ categories.find(c => c.id === cat)?.icon }} {{ cat }}
              </span>
              <el-progress
                :percentage="Math.round(count / maxCount * 100)"
                :show-text="false"
                :stroke-width="8"
                style="flex: 1;"
              />
              <span class="category-progress-count">{{ count }}</span>
            </div>
          </div>
        </el-card>
      </el-col>
      <el-col :xs="24" :md="12">
        <el-card shadow="never" header="最近商品" class="admin-page-card">
          <div class="recent-product-list">
            <div v-for="p in recentProducts" :key="p.id" class="recent-product-item">
              <img :src="p.image" :alt="p.title" class="recent-product-thumb" />
              <div class="recent-product-info">
                <div class="recent-product-title">{{ p.title }}</div>
                <div class="recent-product-sub">{{ p.seller }} · ¥{{ p.price }}</div>
              </div>
              <el-tag size="small" type="info">库存 {{ p.stock }}</el-tag>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>
