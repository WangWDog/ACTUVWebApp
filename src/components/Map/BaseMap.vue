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
import { onMounted, onUnmounted, ref, watch } from 'vue';
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

let boatLayerGroup = null;
let missionLayerGroup = null;
let trajectoryLayerGroup = null;

let boatMarker = null;
let trajectoryPolyline = null;
let trajectoryShadow = null; // <--- 轨迹阴影
let autoSaveTimer = null;

// 下载状态
const downloadProgress = ref(0);
const totalTiles = ref(0);
const savedTiles = ref(0);
const isManualSave = ref(false);

// --- 生命周期 ---
onMounted(() => {
  initMap();
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
    doubleClickZoom: false
  }).setView([45.77, 126.67], 16);

  initOfflineSystem();
  initLayerGroups();
  initBoat();
  initTrajectory();
  initGeoman();
};

const initLayerGroups = () => {
  // 定义不同的 pane 来控制层级
  map.createPane('missionPane');
  map.getPane('missionPane').style.zIndex = 450;

  map.createPane('trajectoryPane');
  map.getPane('trajectoryPane').style.zIndex = 500; // <--- 比 mission 高

  map.createPane('boatPane');
  map.getPane('boatPane').style.zIndex = 650;

  // 初始化图层组并分配到对应的 pane
  missionLayerGroup = L.layerGroup({ pane: 'missionPane' }).addTo(map);
  trajectoryLayerGroup = L.layerGroup({ pane: 'trajectoryPane' }).addTo(map);
  boatLayerGroup = L.layerGroup({ pane: 'boatPane' }).addTo(map);
};

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

const initBoat = () => {
  if (!boatLayerGroup) return;
  const boatIcon = L.icon({
    iconUrl: boatIconImg,
    iconSize: [48, 48],
    iconAnchor: [24, 24],
  });
  const startLat = vehicle.value.position.lat || 45.77;
  const startLng = vehicle.value.position.lng || 126.67;
  boatMarker = L.marker([startLat, startLng], {
    icon: boatIcon,
    rotationAngle: -45,
    rotationOrigin: 'center center',
    zIndexOffset: 2000
  }).addTo(boatLayerGroup);
};

// --- 修改: 初始化轨迹样式 ---
const initTrajectory = () => {
  if (!trajectoryLayerGroup) return;

  // 1. 阴影层
  trajectoryShadow = L.polyline([], {
    color: 'black',
    weight: 7, // 比主线宽
    opacity: 0.4,
    lineJoin: 'round',
  }).addTo(trajectoryLayerGroup);

  // 2. 主线层
  trajectoryPolyline = L.polyline([], {
    color: '#FF4500',
    weight: 5, // 粗实线
    opacity: 1,
    lineJoin: 'round',
  }).addTo(trajectoryLayerGroup);
};


const initGeoman = () => {
  map.pm.setLang('zh');
  map.pm.addControls({
    position: 'topleft',
    drawCircle: false, drawMarker: false, drawPolygon: false,
    drawPolyline: true, editMode: true, dragMode: true, removalMode: true
  });
  map.pm.toggleControls(false);

  map.on('pm:create', (e) => {
    const layer = e.layer;
    const latlngs = layer.getLatLngs();
    store.updatePlannedMission(latlngs);
    map.removeLayer(layer);
    store.triggerRedraw();
  });
};

const renderMissionFromStore = () => {
  if (!map || !missionLayerGroup) return;
  missionLayerGroup.clearLayers();
  const waypoints = store.mission.plannedWaypoints;
  if (!waypoints || waypoints.length === 0) return;
  const latlngs = waypoints.map(p => [p.lat, p.lng]);

  L.polyline(latlngs, {
    color: 'white', weight: 6, opacity: 0.9, lineJoin: 'round'
  }).addTo(missionLayerGroup);
  L.polyline(latlngs, {
    color: '#409EFF', weight: 3, opacity: 1, lineJoin: 'round'
  }).addTo(missionLayerGroup);

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
      zIndexOffset: 1000
    }).addTo(missionLayerGroup);
    marker.on('dragend', (e) => {
      const newPos = e.target.getLatLng();
      store.mission.plannedWaypoints[index].lat = newPos.lat;
      store.mission.plannedWaypoints[index].lng = newPos.lng;
      store.triggerRedraw();
    });
  });
};

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

watch(() => vehicle.value.position, (newPos) => {
  if (boatMarker && newPos.lat && newPos.lng) {
    boatMarker.setLatLng([newPos.lat, newPos.lng]);
  }
}, { deep: true });

watch(() => vehicle.value.attitude.yaw, (newYaw) => {
  if (boatMarker) {
    boatMarker.setRotationAngle(newYaw-45 || -45);
  }
});

// --- 修改: 监听轨迹数据变化 ---
watch(() => vehicle.value.trajectory, (newTrajectory, oldTrajectory) => {
  if (trajectoryPolyline && trajectoryShadow) {
    // 如果是清空操作，则直接设置为空数组
    if (newTrajectory.length === 0 && oldTrajectory.length > 0) {
      trajectoryPolyline.setLatLngs([]);
      trajectoryShadow.setLatLngs([]);
    } else { // 否则是增量更新
      trajectoryPolyline.setLatLngs(newTrajectory);
      trajectoryShadow.setLatLngs(newTrajectory);
    }
  }
}, { deep: true });


watch(() => mapTriggers.value.redrawMission, (val) => {
  if (val) renderMissionFromStore();
});

watch(() => mapTriggers.value.clearMap, (val) => {
  if (val && missionLayerGroup) {
    missionLayerGroup.clearLayers();
  }
});

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
  background: #222;
  z-index: 1;
}

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
  color: #67c23a;
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
.map-seq-icon {
  background-color: #409EFF;
  border: 3px solid white;
  border-radius: 50%;
  color: white;
  text-align: center;
  display: flex;
  justify-content: center;
  align-items: center;
  font-weight: 800;
  font-size: 16px;
  font-family: Arial, sans-serif;
  box-shadow: 0 3px 8px rgba(0,0,0,0.6);
  box-sizing: border-box;
  transition: transform 0.2s;
}

.map-seq-icon:hover {
  transform: scale(1.1);
  background-color: #66b1ff;
}
</style>