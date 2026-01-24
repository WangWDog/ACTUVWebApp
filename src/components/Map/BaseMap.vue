<template>
  <div id="map-container"></div>

  <div v-if="isManualSave && downloadProgress > 0 && downloadProgress < 100" class="download-status">
    <div class="status-header">
      <span>正在缓存任务规划...</span>
      <span class="percentage">{{ downloadProgress }}%</span>
    </div>
    <el-progress
      :percentage="downloadProgress"
      :show-text="false"
      :stroke-width="10"
      status="success"
    />
    <span class="status-detail">已缓存 {{ savedTiles }} / {{ totalTiles }} 张瓦片</span>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted, ref, watch } from 'vue';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// --- 插件引入 ---
import 'leaflet.offline'; // 核心离线库 (基于 IndexedDB)
import '@geoman-io/leaflet-geoman-free';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';
import 'leaflet-rotatedmarker';

// --- 资源与状态管理 ---
import boatIconImg from '../../assets/navigator-arrows.svg'; // 确保路径正确
import { useGcsStore } from '../../store/useGcsStore';
import { storeToRefs } from 'pinia';
import { useRoute } from 'vue-router';

// --- 变量定义 ---
const store = useGcsStore();
const { vehicle, mapTriggers } = storeToRefs(store);
const route = useRoute();

let map = null;
let baseLayer = null;
let boatMarker = null;
let autoSaveTimer = null; // 用于自动保存的防抖定时器
let missionLayerGroup = null; // [新增] 用来统一管理手动重绘的层

// --- 响应式状态 ---
const downloadProgress = ref(0);
const totalTiles = ref(0);
const savedTiles = ref(0);
const isManualSave = ref(false); // 关键标记：区分是"人点的手动下载"还是"自动缓存"

// --- 生命周期 ---
onMounted(() => {
  initMap();
  initLayers();

  // 监听路由切换编辑模式
  watch(() => route.name, (newRouteName) => {
    handleModeChange(newRouteName);
  }, { immediate: true });
});

onUnmounted(() => {
  // 组件销毁时清除定时器，防止内存泄漏
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  if (map) {
    map.remove(); // 清理地图实例
  }
});

// --- 地图初始化 ---
const initMap = () => {
  map = L.map('map-container', {
    zoomControl: false,
    attributionControl: false,
    minZoom: 3,
  }).setView([45.77, 126.67], 16);

  initOfflineSystem();
};

// --- 核心：离线系统配置 (手动+自动) ---
const initOfflineSystem = () => {
  // Google Hybrid (卫星+地名)
  const googleHybridUrl = 'https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}';

  baseLayer = L.tileLayer.offline(googleHybridUrl, {
    maxZoom: 20,
    subdomains: ['0', '1', '2', '3'],
    location: 'indexedDB', // 明确使用 IndexedDB
    saveWhatYouOnto: true, // 允许保存当前视图
    crossOrigin: true,     // 必须开启跨域
  }).addTo(map);

  setupOfflineEvents();
  setupAutoCacheStrategy();
};

// --- 配置离线事件 (进度条逻辑) ---
const setupOfflineEvents = () => {
  baseLayer.on('savestart', (e) => {
    // 只有手动保存时才重置UI进度条，自动保存时不重置以免UI闪烁
    if (isManualSave.value) {
      downloadProgress.value = 0;
      totalTiles.value = e._tilesforSave.length;
      savedTiles.value = 0;
    }
  });

  baseLayer.on('savetileend', () => {
    // 只有手动保存时才更新UI
    if (isManualSave.value) {
      savedTiles.value++;
      if (totalTiles.value > 0) {
        downloadProgress.value = Math.round((savedTiles.value / totalTiles.value) * 100);
      }
    }
  });

  baseLayer.on('loadend', () => {
    // 下载结束的处理
    if (isManualSave.value && downloadProgress.value >= 100) {
      setTimeout(() => {
        downloadProgress.value = 0;
        isManualSave.value = false; // 重置标志位
      }, 2000);
    }
  });
};

// --- 策略：自动静默缓存 ---
const setupAutoCacheStrategy = () => {
  map.on('moveend', () => {
    // 1. 过滤：缩放级别太低(比如看全球视图)时不缓存，只缓存细节图(>=14级)
    if (map.getZoom() < 14) return;

    // 2. 防抖：用户停止操作 1.5 秒后才开始下载，避免拖拽过程中频繁触发
    if (autoSaveTimer) clearTimeout(autoSaveTimer);

    autoSaveTimer = setTimeout(() => {
      // 标记为非手动，这样不会触发大进度条
      isManualSave.value = false;

      const bounds = map.getBounds();
      const currentZoom = map.getZoom();

      // console.log(`[AutoCache] 静默缓存当前区域 Zoom: ${currentZoom}`);

      // 仅保存当前层级，节省资源
      baseLayer.saveTiles(currentZoom,
        () => {}, // 成功回调(空)
        () => {}, // 失败回调(空)
        bounds
      );
    }, 1500);
  });
};

// --- 外部接口：手动保存当前区域 (由父组件按钮调用) ---
const saveCurrentArea = () => {
  if (baseLayer) {
    isManualSave.value = true; // 开启进度条显示
    const bounds = map.getBounds();

    // 手动下载策略：下载 15 到 18 级 (根据需求调整)
    // 注意：一次性下载多层级可能会很慢，建议根据实际需求
    // 这里示例为下载当前层级，如果需要多层级，可以写个循环或根据业务定
    const zoom = map.getZoom();

    baseLayer.saveTiles(zoom, () => {}, () => {}, bounds);
  }
};

defineExpose({ saveCurrentArea });

// --- 图层与交互 ---
const initLayers = () => {
  const boatIcon = L.icon({
    iconUrl: boatIconImg,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });

  boatMarker = L.marker([45.77, 126.67], {
    icon: boatIcon,
    rotationAngle: 0,
    rotationOrigin: 'center center'
  }).addTo(map);
  // Geoman 配置
  missionLayerGroup = L.layerGroup().addTo(map);
  map.pm.setLang('zh');
  map.pm.addControls({
    position: 'topleft',
    drawCircle: false,
    drawMarker: false,
    drawPolygon: false,
    drawPolyline: true,
    editMode: true,
    dragMode: true,
    removalMode: true
  });
  map.pm.toggleControls(false);




  map.on('pm:create', (e) => {
    // 将新画的线同步到 Store
    // 注意：Geoman 画完会自动在地图上保留 Layer，我们需要把它删掉，
    // 然后调用 triggerRedraw 让 Store 数据驱动重绘，这样才能保证样式统一（带序号）
    const latlngs = e.layer.getLatLngs();
    store.updatePlannedMission(latlngs); // 更新数据

    map.removeLayer(e.layer); // 删掉 Geoman 默认画的白线
    store.triggerRedraw();    // 触发根据数据重绘
  });
};
const renderMissionFromStore = () => {
  if (!map || !missionLayerGroup) return;

  // 1. 清空当前画板
  missionLayerGroup.clearLayers();

  const waypoints = store.mission.plannedWaypoints;
  if (waypoints.length === 0) return;

  // 2. 准备坐标数组
  const latlngs = waypoints.map(p => [p.lat, p.lng]);

  // 3. 画线 (Polyline)
  L.polyline(latlngs, {
    color: 'white',
    weight: 7, // 比顶层线宽，形成白边
    opacity: 0.9,
    lineJoin: 'round'
  }).addTo(missionLayerGroup);

  const polyline = L.polyline(latlngs, {
    color: '#409EFF', // Element Plus 主题蓝，或者用亮黄色 '#FFD700' 对比度更高
    weight: 4,        // 实线宽度
    opacity: 1.0,     // 完全不透明
    lineJoin: 'round', // 转角圆润
    // dashArray: '10, 10' // <--- 彻底删除这行代码，去掉虚线
  }).addTo(missionLayerGroup);

 waypoints.forEach((pt, index) => {
    const numberIcon = L.divIcon({
      className: 'map-seq-icon', // CSS 类名不变，去修改样式
      html: `<span>${index + 1}</span>`,
      // 增大尺寸，让数字更易读
      iconSize: [32, 32],
      iconAnchor: [16, 16] // 保持居中 (size的一半)
    });

    const marker = L.marker([pt.lat, pt.lng], {
      icon: numberIcon,
      draggable: true,
      // 提高 zIndex，确保标记永远压在线条上面
      zIndexOffset: 1000
    }).addTo(missionLayerGroup);

    // 5. 绑定标记拖拽事件 -> 更新 Store
    marker.on('dragend', (e) => {
      const newPos = e.target.getLatLng();
      // 直接修改 Store 里的对应点坐标
      store.mission.plannedWaypoints[index].lat = newPos.lat;
      store.mission.plannedWaypoints[index].lng = newPos.lng;
      // 拖拽点后，线也得跟着变，简单起见，再次触发重绘
      store.triggerRedraw();
    });
  });

  // 6. 让新画的线也支持 Geoman 编辑 (可选，如果只靠 Marker 拖拽其实也够了)
  // 如果想支持“拖动线段中间增加点”，需要开启 pm.enable()
  // polyline.pm.enable();
};
const updateMissionStore = (layer) => {
  if (layer && layer.getLatLngs) {
    store.updatePlannedMission(layer.getLatLngs());
  }
};

const handleModeChange = (pageName) => {
  if (!map) return;
  if (pageName === 'planner') {
    map.pm.toggleControls(true);
  } else {
    map.pm.toggleControls(false);
    map.pm.disableDraw();
    map.pm.disableGlobalEditMode();
  }
};

// --- 数据监听 ---
watch(() => vehicle.value.position, (newPos) => {
  if (boatMarker && newPos.lat !== 0) {
    boatMarker.setLatLng([newPos.lat, newPos.lon]);
  }
}, { deep: true });

watch(() => vehicle.value.attitude.yaw, (newYaw) => {
  if (boatMarker) {
    boatMarker.setRotationAngle(newYaw);
  }
});
watch(() => store.mapTriggers.redrawMission, (val) => {
  if (val) {
    renderMissionFromStore();
  }
});

watch(() => store.mapTriggers.clearMap, (val) => {
  if (val) {
    missionLayerGroup.clearLayers();
  }
});
// 1. 监听清空指令
watch(() => mapTriggers.value.clearMap, (val) => {
  if (val && map) {
    // 清除 Geoman 绘制的所有图层
    map.eachLayer((layer) => {
      // 这里的逻辑是：如果图层是 Geoman 画出来的，或者是 missionPolyline，就删掉
      if (layer._pmTempLayer || (layer.pm && !layer._pmTempLayer && layer !== baseLayer && layer !== boatMarker)) {
         map.removeLayer(layer);
      }
    });
    // 如果你有专门的 missionPolyline 变量，也可以在这里 remove
  }
});

// 2. 监听保存指令
watch(() => mapTriggers.value.saveCurrentMap, (val) => {
  if (val) {
    saveCurrentArea(); // 调用之前的保存函数
  }
});
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