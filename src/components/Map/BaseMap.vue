<template>
  <div id="map-container"></div>

  <div v-if="isManualSave && downloadProgress > 0 && downloadProgress < 100" class="download-status">
    <div class="status-header">
      <span>正在缓存作战水域...</span>
      <span class="percentage">{{ downloadProgress }}%</span>
    </div>
    <el-progress :percentage="downloadProgress" :show-text="false" :stroke-width="10" status="success" />
    <span class="status-detail">已缓存 {{ savedTiles }} / {{ totalTiles }} 张瓦片</span>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted, ref, watch, nextTick } from 'vue';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// 插件
import 'leaflet.offline';
import '@geoman-io/leaflet-geoman-free';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';
import 'leaflet-rotatedmarker';

import boatIconImg from '../../assets/navigator-arrows.svg';
import { useGcsStore } from '../../store/useGcsStore';
import { storeToRefs } from 'pinia';
import { useRoute } from 'vue-router';

const store = useGcsStore();
const { vehicle, mapTriggers } = storeToRefs(store);
const route = useRoute();

// --- 变量定义 ---
let map = null;
let baseLayer = null;

// [关键修改 1] 定义两个独立的图层组，互不干扰
let boatLayerGroup = null;     // 专放小船
let missionLayerGroup = null;  // 专放航线

let boatMarker = null;         // 船的实例
let autoSaveTimer = null;

// 下载状态
const downloadProgress = ref(0);
const totalTiles = ref(0);
const savedTiles = ref(0);
const isManualSave = ref(false);

// --- 生命周期 ---
onMounted(() => {
  initMap();

  // 监听路由变化，决定地图是否可编辑
  watch(() => route.name, (newRouteName) => {
    handleModeChange(newRouteName);
  }, { immediate: true });
});

onUnmounted(() => {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  if (map) map.remove();
});

// --- 初始化地图 ---
const initMap = () => {
  map = L.map('map-container', {
    zoomControl: false,
    attributionControl: false,
    minZoom: 3,
    // [优化] 禁用双击放大，防止画图时误触
    doubleClickZoom: false
  }).setView([45.77, 126.67], 16);

  initOfflineSystem(); // 加载底图
  initLayerGroups();   // [关键] 初始化图层组
  initBoat();          // 初始化小船
  initGeoman();        // 初始化绘图工具
};

// --- [关键修改 2] 初始化图层组 ---
const initLayerGroups = () => {
  // 1. 任务图层 (z-index 较低，在线条下面)
  missionLayerGroup = L.layerGroup().addTo(map);

  // 2. 船只图层 (z-index 最高，确保船永远压在航线上)
  // Leaflet 的 pane 机制可以控制层级
  map.createPane('boatPane');
  map.getPane('boatPane').style.zIndex = 600; // 默认 marker pane 是 600，我们设高一点或者直接利用 zIndexOffset

  boatLayerGroup = L.layerGroup().addTo(map);
};

// --- 初始化离线系统 (保持不变) ---
const initOfflineSystem = () => {
  const googleHybridUrl = 'https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}';
  baseLayer = L.tileLayer.offline(googleHybridUrl, {
    maxZoom: 20,
    subdomains: ['0', '1', '2', '3'],
    location: 'indexedDB',
    saveWhatYouOnto: true,
    crossOrigin: true,
  }).addTo(map);

  baseLayer.on('savestart', (e) => {
    if (isManualSave.value) {
      downloadProgress.value = 0;
      totalTiles.value = e._tilesforSave.length;
      savedTiles.value = 0;
    }
  });

  baseLayer.on('savetileend', () => {
    if (isManualSave.value) {
      savedTiles.value++;
      if (totalTiles.value > 0) {
        downloadProgress.value = Math.round((savedTiles.value / totalTiles.value) * 100);
      }
    }
  });

  baseLayer.on('loadend', () => {
    if (isManualSave.value && downloadProgress.value >= 100) {
      setTimeout(() => { downloadProgress.value = 0; isManualSave.value = false; }, 2000);
    }
  });
};

// --- 初始化小船 ---
const initBoat = () => {
  if (!boatLayerGroup) return;

  const boatIcon = L.icon({
    iconUrl: boatIconImg,
    iconSize: [48, 48],
    iconAnchor: [24, 24],
  });

  // 初始位置
  const startLat = vehicle.value.position.lat || 45.77;
  const startLng = vehicle.value.position.lng || 126.67;

  boatMarker = L.marker([startLat, startLng], {
    icon: boatIcon,
    rotationAngle: -45,
    rotationOrigin: 'center center',
    zIndexOffset: 2000 // [关键] 极大的 zIndex，确保压住所有航点
  });

  // 添加到船只专用组，而不是 map
  boatMarker.addTo(boatLayerGroup);
};

// --- 初始化绘图工具 ---
const initGeoman = () => {
  map.pm.setLang('zh');
  map.pm.addControls({
    position: 'topleft',
    drawCircle: false, drawMarker: false, drawPolygon: false,
    drawPolyline: true, editMode: true, dragMode: true, removalMode: true
  });
  map.pm.toggleControls(false);

  // 监听绘制结束 -> 存入 Store -> 重绘
  map.on('pm:create', (e) => {
    const layer = e.layer;
    const latlngs = layer.getLatLngs();
    store.updatePlannedMission(latlngs);

    // [关键] 移除 Geoman 自动生成的线，交由 renderMissionFromStore 统一绘制
    map.removeLayer(layer);
    store.triggerRedraw();
  });
};

// --- [关键修改 3] 渲染任务 (只操作 missionLayerGroup) ---
const renderMissionFromStore = () => {
  if (!map || !missionLayerGroup) return;

  // 1. 只清空任务层，绝对不碰 boatLayerGroup
  missionLayerGroup.clearLayers();

  const waypoints = store.mission.plannedWaypoints;
  if (!waypoints || waypoints.length === 0) return;

  const latlngs = waypoints.map(p => [p.lat, p.lng]);

  // 2. 画线 (双层：白底+蓝芯)
  L.polyline(latlngs, {
    color: 'white', weight: 6, opacity: 0.9, lineJoin: 'round'
  }).addTo(missionLayerGroup);

  L.polyline(latlngs, {
    color: '#409EFF', weight: 3, opacity: 1.0, lineJoin: 'round'
  }).addTo(missionLayerGroup);

  // 3. 画点 (带序号)
  waypoints.forEach((pt, index) => {
    const numberIcon = L.divIcon({
      className: 'map-seq-icon',
      html: `<span>${index + 1}</span>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });

    const marker = L.marker([pt.lat, pt.lng], {
      icon: numberIcon,
      draggable: true,
      zIndexOffset: 1000 // 比线高，但比船低
    }).addTo(missionLayerGroup);

    // 拖拽回写 Store
    marker.on('dragend', (e) => {
      const newPos = e.target.getLatLng();
      // 这里直接修改 Store 数据是浅拷贝修改，为了触发 reactivity 最好用 action
      // 但 store.mission 是 reactive，直接改属性是有效的
      store.mission.plannedWaypoints[index].lat = newPos.lat;
      store.mission.plannedWaypoints[index].lng = newPos.lng;
      store.triggerRedraw();
    });
  });
};

// --- 暴露给外部的方法 ---
const saveCurrentArea = () => {
  if (baseLayer) {
    isManualSave.value = true;
    baseLayer.saveTiles(map.getZoom(), () => {}, () => {}, map.getBounds());
  }
};

const focusBoat = () => {
  if (!map || !vehicle.value.position) return;
  const { lat, lng } = vehicle.value.position;
  if (lat && lng) {
    map.flyTo([lat, lng], 18, { animate: true, duration: 1.0 });
  }
};

defineExpose({ saveCurrentArea, focusBoat });

// --- 监听器 ---

// 1. 监听位置变化 -> 更新小船 (只操作 boatMarker)
watch(() => vehicle.value.position, (newPos) => {
  console.log(newPos)
  if (boatMarker && newPos.lat && newPos.lng) {
    boatMarker.setLatLng([newPos.lat, newPos.lng]);
  }
}, { deep: true });

// 2. 监听航向变化 -> 旋转小船
watch(() => vehicle.value.attitude.yaw, (newYaw) => {
  if (boatMarker) {
    // 假设 SVG 箭头朝上(0度)，无需偏移
    boatMarker.setRotationAngle(newYaw-45 || -45);
  }
});

// 3. 监听重绘触发器 -> 重绘任务 (只操作 missionLayerGroup)
watch(() => mapTriggers.value.redrawMission, (val) => {
  if (val) renderMissionFromStore();
});

// 4. 监听清空触发器
watch(() => mapTriggers.value.clearMap, (val) => {
  if (val && missionLayerGroup) {
    missionLayerGroup.clearLayers();
  }
});

// 5. 路由模式切换
const handleModeChange = (pageName) => {
  if (!map) return;
  if (pageName === 'planner') {
    map.pm.toggleControls(true);
  } else {
    map.pm.toggleControls(false);
    map.pm.disableDraw();
  }
};
</script>

<style scoped>
#map-container {
  width: 100%;
  height: 100%;
  background: #222; /* 卫星图未加载时的底色 */
  z-index: 1;
}

/* 进度条样式美化 */
.download-status {
  position: absolute;
  bottom: 100px;
  left: 50%;
  transform: translateX(-50%);
  width: 360px;
  background: rgba(20, 20, 20, 0.9);
  backdrop-filter: blur(4px);
  padding: 16px 20px;
  border-radius: 12px;
  z-index: 9999;
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.6);
  color: white;
  animation: slideUp 0.3s ease-out;
}
.status-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 14px;
  font-weight: 600;
  color: #fff;
}

.percentage {
  color: #67c23a; /* Element Plus Success Color */
}

.status-detail {
  display: block;
  margin-top: 8px;
  font-size: 12px;
  color: #aaa;
  text-align: right;
}

@keyframes slideUp {
  from { opacity: 0; transform: translate(-50%, 20px); }
  to { opacity: 1; transform: translate(-50%, 0); }
}
</style>
<style>
/* --- 全局样式：高对比度地图标记 --- */
.map-seq-icon {
  /* 主体背景色 */
  background-color: #409EFF;
  /* 强烈的白色边框，形成“光环”隔绝背景干扰 */
  border: 3px solid white;
  /* 确保是正圆 */
  border-radius: 50%;
  /* 文字颜色 */
  color: white;
  /* 文字居中与对齐 */
  text-align: center;
  display: flex;
  justify-content: center;
  align-items: center;
  /* 字体加粗加大 */
  font-weight: 800;
  font-size: 16px;
  font-family: Arial, sans-serif;
  /* 强烈的立体投影，让点“浮”在地图上 */
  box-shadow: 0 3px 8px rgba(0,0,0,0.6);
  /* 确保 padding 不会撑大设定好的 iconSize */
  box-sizing: border-box;
  transition: transform 0.2s;
}

/* 可选：鼠标悬停时放大一下增加交互感 */
.map-seq-icon:hover {
  transform: scale(1.1);
  background-color: #66b1ff;
}
</style>