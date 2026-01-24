<template>
  <el-container class="app-wrapper">
    <el-header class="global-header">
      <div class="left-nav">
        <el-radio-group v-model="currentTab" @change="handleTabChange" fill="#409EFF">
          <el-radio-button value="dashboard">🎮 驾驶舱</el-radio-button>
          <el-radio-button value="planner">🗺️ 任务规划</el-radio-button>
        </el-radio-group>
      </div>

      <div class="center-status">
        <el-tag effect="dark" :type="vehicle.connected ? 'success' : 'danger'">
          {{ vehicle.connected ? 'LINKED' : 'DISCONNECTED' }}
        </el-tag>
        <span class="mode-text">{{ vehicle.mode }}</span>
      </div>

      <div class="right-telemetry">
        <span class="telemetry-item">🛰️ {{ vehicle.gps.sats }}</span>
        <span class="telemetry-item">🔋 {{ vehicle.battery.voltage }}V</span>

        <el-button
            v-if="vehicle.armed"
            type="danger"
            size="small"
            circle
            @click="store.sendPacket('CMD_DISARM', {})"
        >
          STOP
        </el-button>

        <el-button
            v-else
            type="success"
            size="small"
            round
            @click="store.sendPacket('CMD_ARM', {})"
        >
          解锁
        </el-button>
      </div>
    </el-header>

    <el-main class="main-content">
      <div class="map-layer">
        <BaseMap ref="mapRef"/>
      </div>

      <div class="ui-layer">
        <router-view v-slot="{ Component }">
          <keep-alive>
            <component :is="Component"/>
          </keep-alive>
        </router-view>
      </div>
    </el-main>
  </el-container>
</template>

<script setup>
import {onMounted, ref} from 'vue' // 别忘了引入 onMounted
import {useRouter} from 'vue-router'
import {useGcsStore} from './store/useGcsStore'
import {storeToRefs} from 'pinia'
import BaseMap from './components/Map/BaseMap.vue' // 引入地图

const router = useRouter()
const store = useGcsStore()
const {vehicle} = storeToRefs(store)
const mapRef = ref(null) // 获取地图组件实例

// 导航逻辑
const currentTab = ref('dashboard')

const handleTabChange = (val) => {
  router.push(`/${val}`)
}
onMounted(() => {
  store.connectWebSocket();
});
</script>

<style>
/* ...保留之前的 html, body 样式... */
html, body, #app {
  margin: 0;
  padding: 0;
  height: 100%;
  width: 100%;
  overflow: hidden;
  font-family: Arial, sans-serif;
}

.app-wrapper {
  height: 100vh;
  background: #000;
}

.global-header {
  background-color: rgba(43, 43, 43, 0.9); /* 半透明 */
  backdrop-filter: blur(5px);
  color: white;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #555;
  height: 60px;
  z-index: 2000;
  padding: 0 20px;
}

.main-content {
  padding: 0 !important;
  position: relative;
  height: calc(100vh - 60px);
}

/* --- 关键层级设计 --- */
.map-layer {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 1; /* 底层 */
}

.ui-layer {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 10; /* 顶层 */
  pointer-events: none; /* 关键：让鼠标点击穿透 UI 层直接操作地图 */
}

/* 恢复 UI 层内部元素的点击事件 */
.ui-layer > * {
  pointer-events: auto;
}

/* 但如果是全屏容器，需要让容器穿透，只有容器里的按钮/面板不穿透 */
.view-container {
  pointer-events: none;
  width: 100%;
  height: 100%;
}

.view-container .interactive-panel {
  pointer-events: auto; /* 只有这个 class 的元素可以点击 */
}
</style>