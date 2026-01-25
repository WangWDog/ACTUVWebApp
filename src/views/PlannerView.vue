<template>
  <div class="view-container">

    <div class="planner-panel" :class="{ 'is-collapsed': isCollapsed }">

      <div class="toggle-btn" @click="isCollapsed = !isCollapsed">
        <el-icon><component :is="isCollapsed ? 'ArrowLeft' : 'ArrowRight'" /></el-icon>
      </div>

      <div class="panel-content-wrapper">
        <el-tabs v-model="activeTab" class="hud-tabs">

          <el-tab-pane label="航线" name="mission">
            <div class="tab-content">

              <div class="defaults-bar">
                <span class="bar-label">默认值:</span>
                <div class="input-group">
                  <span>速度</span>
                  <input type="number" class="hud-input mini" v-model.number="mission.defaults.speed" step="0.5">
                </div>
                <div class="input-group">
                  <span>停留</span>
                  <input type="number" class="hud-input mini" v-model.number="mission.defaults.loiter">
                </div>
              </div>

              <div class="tools-header">
                <span class="info-text">共 {{ mission.plannedWaypoints.length }} 个航点 (可拖拽排序)</span>
                <el-button type="danger" link size="small" @click="handleClear">清空</el-button>
              </div>

              <el-table
                ref="tableRef"
                row-key="seq"
                :data="mission.plannedWaypoints"
                height="280"
                size="small"
                class="hud-table draggable-table"
                empty-text="请在地图绘制"
              >
                <el-table-column width="30" align="center">
                  <template #default>
                    <el-icon class="drag-handle"><Grid /></el-icon>
                  </template>
                </el-table-column>

                <el-table-column label="#" prop="seq" width="35" align="center">
                  <template #default="scope">
                    <span class="seq-badge">{{ scope.$index + 1 }}</span>
                  </template>
                </el-table-column>

                <el-table-column label="速度" width="75" align="center">
                  <template #default="scope">
                    <input type="number" class="hud-input" v-model.number="scope.row.speed" step="0.5" min="0">
                  </template>
                </el-table-column>

                <el-table-column label="停留" width="60" align="center">
                  <template #default="scope">
                    <input type="number" class="hud-input" v-model.number="scope.row.loiter" min="0">
                  </template>
                </el-table-column>

                <el-table-column label="操作" width="40" align="center">
                  <template #default="scope">
                     <el-icon class="delete-icon" @click="confirmRemove(scope.$index)"><Close /></el-icon>
                  </template>
                </el-table-column>
              </el-table>

              <div class="action-footer">
                <button class="hud-btn primary" @click="handleUpload">
                  <el-icon><Upload /></el-icon> 上传任务
                </button>
                <button class="hud-btn primary" @click="handleDownload">
                  <el-icon><Download /></el-icon> 下载任务
                </button>
              </div>

            </div>
          </el-tab-pane>

          <el-tab-pane label="地图" name="offline">
             <button class="hud-btn success" @click="handleSaveMap">
                <el-icon><MapLocation /></el-icon> 下载当前视野
              </button>
          </el-tab-pane>

        </el-tabs>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useGcsStore } from '../store/useGcsStore';
import { storeToRefs } from 'pinia';
import { ElMessageBox } from 'element-plus';
import Sortable from 'sortablejs';
import { Upload, Close, ArrowRight, ArrowLeft, Grid, MapLocation } from '@element-plus/icons-vue';

const store = useGcsStore();
const { mission } = storeToRefs(store);

const isCollapsed = ref(false);
const activeTab = ref('mission');
const tableRef = ref(null);

// --- 拖拽排序初始化 ---
onMounted(() => {
  const tbody = document.querySelector('.draggable-table .el-table__body-wrapper tbody');
  if (tbody) {
    Sortable.create(tbody, {
      handle: '.drag-handle', // 只能通过手柄拖拽
      animation: 150,
      ghostClass: 'sortable-ghost',
      onEnd: ({ newIndex, oldIndex }) => {
        // 1. 调整数据顺序
        const targetRow = mission.value.plannedWaypoints.splice(oldIndex, 1)[0];
        mission.value.plannedWaypoints.splice(newIndex, 0, targetRow);

        // 2. 重新生成序号
        mission.value.plannedWaypoints.forEach((pt, idx) => pt.seq = idx + 1);

        // 3. 强制地图重绘 (同步线和点)
        store.triggerRedraw();
      }
    });
  }
});

// --- 删除确认 ---
const confirmRemove = (index) => {
  ElMessageBox.confirm(
    '确定要删除这个航点吗?',
    '删除确认',
    {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
      customClass: 'hud-message-box' // 下面会自定义这个样式适配暗黑风
    }
  ).then(() => {
    // 1. 删除数据
    mission.value.plannedWaypoints.splice(index, 1);
    // 2. 重新排序号
    mission.value.plannedWaypoints.forEach((pt, idx) => pt.seq = idx + 1);
    // 3. 触发地图重绘
    store.triggerRedraw();
  }).catch(() => {});
};

const handleClear = () => {
  ElMessageBox.confirm('确定要清空所有航点吗?', '警告', {
    confirmButtonText: '清空', cancelButtonText: '取消', type: 'error'
  }).then(() => {
    store.triggerMapClear();
  }).catch(()=>{});
};

const handleUpload = () => {
  if (mission.value.plannedWaypoints.length === 0) {
    ElMessage.warning("请先绘制航线");
    return;
  }

  // 1. 转换数据格式为后端所需
  const missionItems = mission.value.plannedWaypoints.map(pt => ({
    seq: pt.seq,
    latitude: pt.lat,
    longitude: pt.lng,
    relative_altitude_m: 0, // 水面船高度 0
    speed_m_s: pt.speed,
    acceptance_radius_m: 3.0, // 可以做成全局配置
    yaw_deg: Number.NaN, // 自动航向
    is_fly_through: true
  }));

  // 2. 发送指令
  store.sendPacket("CMD_UPLOAD_MISSION", {
    mission_items: missionItems
  });
};

const handleDownload = () => {
    store.sendPacket("CMD_DOWNLOAD_MISSION", {});
};
const handleSaveMap = () => store.triggerMapSave();

</script>

<style scoped>
/* ... 之前的 Panel 样式保持不变 ... */
.view-container { width: 100%; height: 100%; position: relative; pointer-events: none; overflow: hidden; }
.planner-panel { pointer-events: auto; position: absolute; top: 80px; right: 0; width: 280px; max-height: 80%; background: rgba(0, 0, 0, 0.65); backdrop-filter: blur(12px); border-left: 1px solid rgba(255, 255, 255, 0.15); border-bottom: 1px solid rgba(255, 255, 255, 0.15); border-top-left-radius: 8px; border-bottom-left-radius: 8px; transition: transform 0.3s; display: flex; }
.planner-panel.is-collapsed { transform: translateX(280px); }
.toggle-btn { position: absolute; left: -24px; top: 50%; transform: translateY(-50%); width: 24px; height: 48px; background: rgba(0, 0, 0, 0.65); backdrop-filter: blur(12px); cursor: pointer; color: #ccc; display: flex; align-items: center; justify-content: center; border-radius: 4px 0 0 4px; }
.panel-content-wrapper { width: 100%; padding: 10px 15px; }

/* --- 新增样式 --- */

/* 默认值设置栏 */
.defaults-bar {
  display: flex; align-items: center; gap: 8px;
  background: rgba(255,255,255,0.05); padding: 8px; border-radius: 4px; margin-bottom: 10px;
}
.bar-label { font-size: 11px; color: #aaa; }
.input-group { display: flex; align-items: center; gap: 4px; font-size: 11px; color: #ddd; }
.hud-input.mini { width: 40px; padding: 2px; text-align: center; }

/* 拖拽相关 */
.drag-handle { cursor: move; color: #888; }
.drag-handle:hover { color: #fff; }
.sortable-ghost { opacity: 0.5; background: rgba(64, 158, 255, 0.2) !important; }
.seq-badge {
  background: #409EFF; color: white; border-radius: 50%;
  width: 16px; height: 16px; display: inline-flex;
  align-items: center; justify-content: center; font-size: 10px;
}

/* 覆盖表格 */
:deep(.hud-table) { background: transparent; --el-table-tr-bg-color: transparent; --el-table-header-bg-color: rgba(255,255,255,0.05); --el-table-text-color: #eee; --el-table-border-color: rgba(255,255,255,0.1); font-size: 12px; }
.hud-input { width: 100%; background: rgba(255,255,255,0.1); border: 1px solid transparent; color: white; border-radius: 4px; padding: 4px; text-align: center; }
.hud-input:focus { border-color: #409EFF; outline: none; }
.hud-btn { width: 100%; padding: 10px; border: none; border-radius: 4px; color: white; font-weight: 600; cursor: pointer; margin-top: 10px; display: flex; align-items: center; justify-content: center; gap: 8px; }
.hud-btn.primary { background: #409EFF; }
.hud-btn.success { background: #67c23a; }
.delete-icon { cursor: pointer; color: #f56c6c; }

/* Tabs */
:deep(.el-tabs__item) { color: #999; }
:deep(.el-tabs__item.is-active) { color: #409EFF; }
:deep(.el-tabs__nav-wrap::after) { background: rgba(255,255,255,0.1); }
</style>

<style>
.hud-message-box {
  background: rgba(30, 30, 30, 0.95) !important;
  backdrop-filter: blur(10px);
  border: 1px solid #444 !important;
}
.hud-message-box .el-message-box__title { color: white !important; }
.hud-message-box .el-message-box__message { color: #ddd !important; }
</style>