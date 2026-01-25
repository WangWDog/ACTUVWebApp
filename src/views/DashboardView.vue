<template>
  <div class="view-container">

    <div class="log-terminal" :class="{ 'collapsed': logCollapsed }">
      <div class="terminal-header" @click="logCollapsed = !logCollapsed">
        <span class="title">
          <el-icon><Microphone/></el-icon> 系统消息
        </span>
        <el-icon :class="{ 'rotate': logCollapsed }">
          <ArrowDown/>
        </el-icon>
      </div>

      <div class="terminal-body" ref="logBodyRef">
        <div v-if="sysLogs.length === 0" class="empty-log">暂无消息...</div>

        <div
            v-for="log in sysLogs"
            :key="log.id"
            class="log-line"
            :class="getLogLevelClass(log.level)"
        >
          <span class="log-time">[{{ log.time }}]</span>
          <span class="log-text">{{ log.text }}</span>
        </div>
      </div>
    </div>

    <div class="hud-top-bar">

      <el-popover placement="bottom" :width="200" trigger="click" popper-class="hud-popover">
        <template #reference>
          <div class="hud-item mode-item" :class="{ 'disconnected': !vehicle.connected }">
            <el-icon v-if="vehicle.connected"><Link/></el-icon>
            <el-icon v-else><Link/></el-icon>
            <span class="hud-value">{{ vehicle.connected ? vehicle.mode : 'OFFLINE' }}</span>
          </div>
        </template>
        <div class="popover-content">
          <h4>模式切换</h4>
          <div class="mode-grid">
<!--            <button class="mode-btn" @click="changeMode('MANUAL')">MANUAL</button>-->
            <button class="mode-btn" @click="changeMode('MISSION')">MISSION</button>
            <button class="mode-btn" @click="changeMode('HOLD')">HOLD</button>
            <button class="mode-btn danger" @click="changeMode('RTL')">RTL (返航)</button>
          </div>
        </div>
      </el-popover>

      <el-popover placement="bottom" :width="220" trigger="click" popper-class="hud-popover">
        <template #reference>
          <div class="hud-item">
            <span class="hud-label">GPS</span>
            <span class="hud-value">{{ (vehicle.gps.sats ?? 0) }} <small>SAT</small></span>
          </div>
        </template>
        <div class="popover-content">
          <h4>GPS 详情</h4>
          <p>定位状态: <span class="highlight">{{ vehicle.gps.fix }}</span></p>
          <p>经度: {{ (vehicle.position.lng ?? 0).toFixed(6) }}</p>
          <p>纬度: {{ (vehicle.position.lat ?? 0).toFixed(6) }}</p>
          <el-divider style="margin: 10px 0; border-color: #555"/>
          <el-button type="warning" size="small" style="width: 100%" @click="setHomePoint">
            设当前点为返航点 (Home)
          </el-button>
        </div>
      </el-popover>

      <el-popover placement="bottom" :width="180" trigger="click" popper-class="hud-popover">
        <template #reference>
          <div class="hud-item">
            <span class="hud-label">BAT</span>
            <span class="hud-value">{{ (vehicle.battery.voltage ?? 0).toFixed(1) }}<small>V</small></span>
          </div>
        </template>
        <div class="popover-content">
          <h4>电源状态</h4>
          <p>剩余电量: <span :style="{color: getBatColor}">{{ ((vehicle.battery.percent ?? 0) * 100).toFixed(0) }}%</span></p>
          <p>当前电压: {{ (vehicle.battery.voltage ?? 0).toFixed(2) }} V</p>
          <p>瞬时电流: {{ (vehicle.battery.current ?? 0).toFixed(1) }} A</p>
        </div>
      </el-popover>

      <div class="hud-item">
        <span class="hud-label">SPD</span>
        <span class="hud-value">{{ (vehicle.velocity.speed ?? 0).toFixed(1) }} <small>m/s</small></span>
      </div>

      <div class="hud-item">
        <span class="hud-label">HDG</span>
        <span class="hud-value">{{ (vehicle.attitude.yaw ?? 0).toFixed(0) }}°</span>
      </div>

    </div>

    <transition name="slide-up">
      <div class="bottom-control-panel" v-if="vehicle.connected">

<!--        <div class="control-group manual-group">-->
<!--          <div class="joystick-box left">-->
<!--            <VirtualJoystick @update="handleLeftStick" @end="resetLeftStick"/>-->
<!--            <span class="stick-label">THROTTLE</span>-->
<!--          </div>-->

<!--          <div class="center-actions">-->
<!--            <el-tooltip content="一键返航" placement="top">-->
<!--              <el-button type="warning" circle size="large" @click="changeMode('RTL')">-->
<!--                <el-icon><HomeFilled/></el-icon>-->
<!--              </el-button>-->
<!--            </el-tooltip>-->

<!--            <button-->
<!--                class="arm-btn"-->
<!--                :class="{ 'armed': vehicle.armed }"-->
<!--                @click="toggleArm"-->
<!--            >-->
<!--              <div class="inner-ring">-->
<!--                <el-icon size="24"><SwitchButton/></el-icon>-->
<!--                <span>{{ vehicle.armed ? 'LOCKED' : 'UNLOCK' }}</span>-->
<!--              </div>-->
<!--            </button>-->
<!--          </div>-->

<!--          <div class="joystick-box right">-->
<!--            <VirtualJoystick @update="handleRightStick" @end="resetRightStick"/>-->
<!--            <span class="stick-label">STEERING</span>-->
<!--          </div>-->
<!--        </div>-->

        <div v-if="vehicle.mode === 'MISSION'" class="control-group mission-group">
          <div class="mission-info">
            <h3>自动巡航中</h3>
            <p>正在前往航点 #{{ currentWaypointIndex }} / {{ totalWaypoints }}</p>
            <el-progress
                :percentage="missionProgress"
                :stroke-width="10"
                status="success"
                class="mission-progress"
            />
          </div>

          <div class="mission-btns">
            <el-button type="warning" round size="large" @click="pauseMission">
              <el-icon><VideoPause/></el-icon> 暂停
            </el-button>

            <el-button type="danger" round size="large" @click="changeMode('MANUAL')">
              <el-icon><Aim/></el-icon> 手动接管
            </el-button>
          </div>
        </div>
      </div>
    </transition>

  </div>
</template>

<script setup>
import { computed, onUnmounted, ref } from 'vue';
import { useGcsStore } from '../store/useGcsStore';
import { storeToRefs } from 'pinia';
import VirtualJoystick from '../components/Cockpit/VirtualJoystick.vue';
import { throttle } from 'lodash';
// --- 关键修复：导入了 Microphone 和 ArrowDown ---
import {
  Aim, HomeFilled, Link, Loading, SwitchButton, VideoPause,
  Microphone, ArrowDown
} from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';

const store = useGcsStore();
const { vehicle, sysLogs, mission } = storeToRefs(store);

// --- 状态计算 ---
const getBatColor = computed(() => vehicle.value.battery.percent > 0.3 ? '#67c23a' : '#f56c6c');

// 模拟任务进度
// --- [核心修改] 任务进度绑定真实数据 ---
// MAVSDK 的 current 是从 0 开始的索引，UI上显示通常习惯 +1
const currentWaypointIndex = computed(() => {
  // 如果 total 为 0，说明没任务，显示 0；否则显示 current + 1
  return mission.value.progress.total > 0 ? mission.value.progress.current + 1 : 0;
});

const totalWaypoints = computed(() => mission.value.progress.total);

const missionProgress = computed(() => {
  const total = mission.value.progress.total;
  const current = mission.value.progress.current;
  if (!total || total === 0) return 0;

  // 计算百分比。注意：current 到达 total 时任务才算真正完成，但在过程中
  // current 指向的是“正在前往的点”。
  // 简单算法：(current / total) * 100
  let pct = (current / total) * 100;
  return Math.min(Math.max(pct, 0), 100);
});
// --- 核心控制逻辑 ---
const logCollapsed = ref(false);

const getLogLevelClass = (level) => {
  if (level.includes('ERROR') || level.includes('FAIL')) return 'log-error';
  if (level.includes('WARN')) return 'log-warn';
  return 'log-info';
};

const changeMode = (mode) => {
  store.sendPacket('CMD_SET_MODE', {mode: mode});
};

const toggleArm = () => {
  if (vehicle.value.armed) {
    ElMessageBox.confirm('确定要停止电机吗？如果在水中央，船将失去动力。', '安全警告', {
      confirmButtonText: '确定停止',
      cancelButtonText: '取消',
      type: 'warning',
      customClass: 'hud-message-box'
    }).then(() => {
      store.sendPacket('CMD_DISARM', {});
    });
  } else {
    store.sendPacket('CMD_ARM', {});
  }
};

const setHomePoint = () => {
  console.log("Request Set Home");
  store.sendPacket('CMD_CUSTOM_ACTION', {action: 'SET_HOME_CURRENT'});
  ElMessage.success('已请求将当前位置设为返航点');
};

const pauseMission = () => {
  store.sendPacket('CMD_MISSION_ACTION', {action: 'PAUSE'});
};

// --- 摇杆逻辑 ---
const controlState = ref({x: 0.0, y: 0.0, z: 0.5, r: 0.0});
const sendControlCommand = throttle(() => {
  store.sendPacket("CMD_MANUAL_CONTROL", {
    x: controlState.value.x,
    y: 0.0,
    z: 0.5,
    r: controlState.value.r
  });
}, 100);

const handleLeftStick = (vec) => { controlState.value.x = vec.y; sendControlCommand(); };
const resetLeftStick = () => { controlState.value.x = 0.0; sendControlCommand(); };
const handleRightStick = (vec) => { controlState.value.r = vec.x; sendControlCommand(); };
const resetRightStick = () => { controlState.value.r = 0.0; sendControlCommand(); };

onUnmounted(() => { sendControlCommand.cancel(); });
</script>

<style scoped>
.view-container {
  width: 100%;
  height: 100%;
  position: relative;
  pointer-events: none;
  overflow: hidden;
}

/* ================= 日志终端 ================= */
.log-terminal {
  pointer-events: auto;
  position: absolute;
  left: 20px;
  bottom: 100px;
  width: 320px;
  background: rgba(0, 0, 0, 0.8);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  transition: all 0.3s ease;
  z-index: 100;
  max-height: 200px;
  overflow: hidden;
}

.log-terminal.collapsed {
  max-height: 36px;
  background: rgba(0, 0, 0, 0.5);
}

.terminal-header {
  height: 36px;
  padding: 0 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(255, 255, 255, 0.05);
  cursor: pointer;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  color: #ccc;
  font-size: 12px;
  font-weight: bold;
}

.terminal-header .title { display: flex; align-items: center; gap: 6px; }

.terminal-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 11px;
  display: flex;
  flex-direction: column-reverse;
}
.terminal-body::-webkit-scrollbar { width: 4px; }
.terminal-body::-webkit-scrollbar-thumb { background: #555; border-radius: 2px; }

.log-line { margin-bottom: 4px; line-height: 1.4; word-break: break-all; }
.log-time { color: #666; margin-right: 6px; }
.log-info { color: #a6e22e; }
.log-warn { color: #e6db74; }
.log-error { color: #f92672; }
.empty-log { color: #555; text-align: center; margin-top: 10px; font-style: italic; }
.rotate { transform: rotate(180deg); transition: transform 0.3s; }


/* ================= 顶部 HUD 样式 ================= */
.hud-top-bar {
  pointer-events: auto;
  position: absolute;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 12px;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(8px);
  padding: 8px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  z-index: 1500; /* 确保层级够高 */
}

.hud-item {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  min-width: 60px; padding: 4px 12px; border-radius: 8px; cursor: pointer; transition: background 0.2s;
}
.hud-item:hover { background: rgba(255, 255, 255, 0.1); }
.hud-label { font-size: 10px; color: #aaa; margin-bottom: 2px; }
.hud-value { font-size: 16px; font-weight: 700; color: white; font-family: 'DIN Alternate', sans-serif; }
small { font-size: 10px; font-weight: normal; margin-left: 2px; }

.mode-item { background: #409EFF; color: white; flex-direction: row; gap: 6px; padding: 0 16px; }
.mode-item.disconnected { background: #f56c6c; }

/* ================= 底部控制区 ================= */
.bottom-control-panel {
  pointer-events: auto;
  position: absolute;
  bottom: 80px;
  left: 0;
  width: 100%;
  min-height: 200px;
  display: flex;
  justify-content: center;
  align-items: flex-end;
  padding-bottom: 10px;
  z-index: 1000;
}

.manual-group { width: 100%; padding: 0 40px; display: flex; justify-content: space-between; align-items: flex-end; }
.joystick-box { display: flex; flex-direction: column; align-items: center; gap: 8px; background: rgba(0, 0, 0, 0.3); padding: 15px; border-radius: 20px; backdrop-filter: blur(5px); }
.stick-label { font-size: 12px; color: #ccc; font-weight: bold; }
.center-actions { display: flex; flex-direction: column; align-items: center; gap: 20px; margin-bottom: 20px; }

.arm-btn { width: 80px; height: 80px; border-radius: 50%; border: none; background: linear-gradient(135deg, #67c23a, #42d885); box-shadow: 0 4px 15px rgba(103, 194, 58, 0.4); cursor: pointer; transition: all 0.3s; padding: 4px; }
.arm-btn.armed { background: linear-gradient(135deg, #f56c6c, #ff4949); box-shadow: 0 4px 15px rgba(245, 108, 108, 0.4); }
.arm-btn:active { transform: scale(0.95); }
.inner-ring { width: 100%; height: 100%; border-radius: 50%; border: 2px dashed rgba(255, 255, 255, 0.5); display: flex; flex-direction: column; justify-content: center; align-items: center; color: white; }
.inner-ring span { font-size: 10px; font-weight: bold; margin-top: 4px; }

.mission-group { background: rgba(0, 0, 0, 0.7); backdrop-filter: blur(12px); padding: 20px 40px; border-radius: 16px; border: 1px solid rgba(255, 255, 255, 0.1); display: flex; flex-direction: column; align-items: center; gap: 20px; min-width: 400px; }
.mission-info { text-align: center; width: 100%; color: white; }
.mission-info h3 { margin: 0 0 5px 0; color: #67c23a; }
.mission-info p { margin: 0 0 15px 0; color: #ccc; font-size: 14px; }
.mission-btns { display: flex; gap: 20px; }

.other-group { text-align: center; background: rgba(0, 0, 0, 0.6); padding: 20px; border-radius: 16px; color: white; }
.rotating { animation: rotate 2s linear infinite; margin-bottom: 10px; }
@keyframes rotate { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

.slide-up-enter-active, .slide-up-leave-active { transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
.slide-up-enter-from, .slide-up-leave-to { opacity: 0; transform: translateY(50px); }
</style>

<style>
.hud-popover.el-popover { background: rgba(30, 30, 30, 0.95) !important; border: 1px solid #555 !important; color: white !important; backdrop-filter: blur(10px); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5) !important; }
.hud-popover .el-popper__arrow::before { background: rgba(30, 30, 30, 0.95) !important; border-color: #555 !important; }
.popover-content h4 { margin: 0 0 10px 0; color: #aaa; font-size: 12px; text-transform: uppercase; }
.popover-content p { margin: 5px 0; font-size: 14px; display: flex; justify-content: space-between; }
.highlight { color: #409EFF; font-weight: bold; }
.mode-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.mode-btn { background: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.2); color: white; padding: 8px; border-radius: 4px; cursor: pointer; }
.mode-btn:hover { background: #409EFF; border-color: #409EFF; }
.mode-btn.danger { grid-column: span 2; color: #f56c6c; border-color: rgba(245, 108, 108, 0.3); }
.mode-btn.danger:hover { background: #f56c6c; color: white; }
</style>