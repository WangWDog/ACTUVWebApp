<template>
  <div class="view-container">

    <div class="hud-top-bar">

      <el-popover placement="bottom-start" :width="350" trigger="hover" popper-class="hud-popover log-popover">
        <template #reference>
          <div class="hud-item icon-btn">
            <el-badge :value="sysLogs.length > 0 ? sysLogs.length : ''" :max="99" is-dot class="log-badge">
              <el-icon>
                <Bell/>
              </el-icon>
            </el-badge>
            <span class="hud-label-mini">消息</span>
          </div>
        </template>
        <div class="terminal-body">
          <div v-if="sysLogs.length === 0" class="empty-log">暂无系统消息</div>
          <div v-for="log in reversedLogs" :key="log.id" class="log-line" :class="getLogLevelClass(log.level)">
            <span class="log-time">[{{ log.time }}]</span>
            <span class="log-text">{{ log.text }}</span>
          </div>
        </div>
      </el-popover>

      <div class="divider"></div>

      <el-popover placement="bottom" :width="240" trigger="click" popper-class="hud-popover">
        <template #reference>
          <div class="hud-item mode-item" :class="{ 'disconnected': !vehicle.connected }">
            <el-icon class="status-icon">
              <Link/>
            </el-icon>
            <div class="col-flex">
              <span class="hud-value">{{ vehicle.connected ? vehicle.mode : 'OFFLINE' }}</span>
              <span v-if="vehicle.mode === 'OFFBOARD'" class="sub-mode-tag">{{ offboardSubMode }}</span>
            </div>
          </div>
        </template>
        <div class="popover-content">
          <h4>飞行模式选择</h4>
          <div class="mode-grid">
            <button class="mode-btn" @click="changeMode('OFFBOARD')">OFFBOARD (控制)</button>
            <button class="mode-btn" @click="enableFollowMode">FOLLOW (指点)</button>
            <button class="mode-btn" @click="changeMode('MISSION')">MISSION (任务)</button>
            <button class="mode-btn" @click="changeMode('HOLD')">HOLD (悬停)</button>
            <button class="mode-btn danger" @click="changeMode('RTL')">RTL (返航)</button>
          </div>
        </div>
      </el-popover>

      <el-popover placement="bottom" :width="220" trigger="hover" popper-class="hud-popover">
        <template #reference>
          <div class="hud-item">
            <span class="hud-value">{{ vehicle.gps.sats ?? 0 }}</span>
            <span class="hud-label">SAT</span>
          </div>
        </template>
        <div class="popover-content">
          <p>定位状态: <span class="highlight">{{ vehicle.gps.fix }}</span></p>
          <p>经度: {{ (vehicle.position.lng ?? 0).toFixed(6) }}</p>
          <p>纬度: {{ (vehicle.position.lat ?? 0).toFixed(6) }}</p>
          <el-divider style="margin: 10px 0; border-color: #555"/>
          <el-button type="warning" size="small" style="width: 100%" @click="setHomePoint">
            设为返航点 (Home)
          </el-button>
        </div>
      </el-popover>

      <el-popover placement="bottom" :width="180" trigger="hover" popper-class="hud-popover">
        <template #reference>
          <div class="hud-item">
            <span class="hud-value" :style="{color: getBatColor}">
              {{ ((vehicle.battery.percent ?? 0) * 100).toFixed(0) }}<small>%</small>
            </span>
            <span class="hud-label">BAT</span>
          </div>
        </template>
        <div class="popover-content">
          <h4>电源状态</h4>
          <p>电压: {{ (vehicle.battery.voltage ?? 0).toFixed(2) }} V</p>
          <p>电流: {{ (vehicle.battery.current ?? 0).toFixed(1) }} A</p>
        </div>
      </el-popover>

      <div class="hud-item">
        <span class="hud-value">{{ (vehicle.velocity.speed ?? 0).toFixed(1) }}</span>
        <span class="hud-label">m/s</span>
      </div>

      <div class="hud-item">
        <span class="hud-value">{{ (vehicle.attitude.yaw ?? 0).toFixed(0) }}°</span>
        <span class="hud-label">HDG</span>
      </div>

      <div class="divider"></div>

      <el-popover placement="bottom" :width="200" trigger="click" popper-class="hud-popover">
        <template #reference>
          <div class="hud-item arm-item" :class="vehicle.armed ? 'armed' : 'disarmed'">
            <span class="hud-value status-text">{{ vehicle.armed ? 'ARMED' : 'DISARM' }}</span>
          </div>
        </template>
        <div class="popover-content">
          <h4>电机安全锁</h4>
          <div class="mode-grid">
            <button class="mode-btn success" @click="sendArmCommand('ARM', false)">解锁 (Arm)</button>
            <button class="mode-btn warning" @click="sendArmCommand('DISARM', false)">上锁 (Disarm)</button>
            <button class="mode-btn danger" @click="sendArmCommand('ARM', true)">强制解锁</button>
            <button class="mode-btn danger" @click="sendArmCommand('DISARM', true)">强制上锁</button>
          </div>
        </div>
      </el-popover>

      <div class="hud-item icon-btn" @click="handleCenterMap" title="回到小船">
        <el-icon>
          <Aim/>
        </el-icon>
        <span class="hud-label-mini">定位</span>
      </div>

    </div>

    <transition name="slide-up">
      <div class="bottom-dashboard" v-if="vehicle.connected && ['OFFBOARD', 'MISSION'].includes(vehicle.mode)">

        <template v-if="vehicle.mode === 'OFFBOARD'">
          <div class="joystick-box left">
            <div class="joystick-field">
              <VirtualJoystick @update="handleLeftStick" @end="resetLeftStick"/>
            </div>
            <span class="stick-label">THROTTLE</span>
          </div>

          <div class="center-panel">
            <div class="manual-controls">
              <div class="mode-switch-group">
                <div class="switch-item" :class="{ active: offboardSubMode === 'STEADY' }"
                     @click="handleSubModeChange('STEADY')">稳态
                </div>
                <div class="switch-item" :class="{ active: offboardSubMode === 'ACRO' }"
                     @click="handleSubModeChange('ACRO')">特技
                </div>
              </div>
              <div class="control-hint">
                {{ offboardSubMode === 'STEADY' ? '辅助定速控制' : '直接电机控制' }}
              </div>
            </div>
          </div>


          <div class="joystick-box right">
            <div class="joystick-field">
              <VirtualJoystick @update="handleRightStick" @end="resetRightStick"/>
            </div>
            <span class="stick-label">STEERING</span>
          </div>
        </template>

        <template v-else-if="vehicle.mode === 'MISSION'">
          <div class="mission-dashboard">

            <div class="mission-side-btn">
              <div
                  class="hud-action-btn"
                  :class="missionState === 'EXECUTING' ? 'btn-pause' : 'btn-resume'"
                  @click="controlMission(missionState === 'EXECUTING' ? 'PAUSE' : 'RESUME')"
              >
                <el-icon v-if="missionState === 'EXECUTING'">
                  <VideoPause/>
                </el-icon>
                <el-icon v-else>
                  <VideoPlay/>
                </el-icon>
                <div class="btn-text">
                  <span class="main-text">{{ missionState === 'EXECUTING' ? '暂停' : '继续' }}</span>
                  <span class="sub-text">{{ missionState === 'EXECUTING' ? 'PAUSE' : 'RESUME' }}</span>
                </div>
              </div>
            </div>

            <div class="mission-center-stat">
              <div class="wp-counter">
                <span class="label">WAYPOINT</span>
                <span class="val">{{ currentWaypointIndex }} <span class="divider">/</span> {{ totalWaypoints }}</span>
              </div>

              <div class="mission-progress-bar">
                <div class="progress-fill" :style="{ width: missionProgress + '%' }">
                  <div class="glow-head"></div>
                </div>
              </div>

              <div class="mission-status-text">
                状态: {{ missionState === 'EXECUTING' ? '正在巡航' : '已暂停等待' }}
              </div>
            </div>

            <div class="mission-side-btn">
              <div class="hud-action-btn btn-abort" @click="cancelMission">
                <el-icon>
                  <SwitchButton/>
                </el-icon>
                <div class="btn-text">
                  <span class="main-text">取消任务</span>
                  <span class="sub-text">MANUAL</span>
                </div>
              </div>
            </div>

          </div>
        </template>

      </div>
    </transition>

    <div v-if="!vehicle.connected" class="offline-mask">
      <div class="offline-box">
        <el-icon class="rotating-slow">
          <Loading/>
        </el-icon>
        <h2>连接断开</h2>
        <p>正在尝试重新连接飞控...</p>
      </div>
    </div>

    <el-dialog v-model="followDialog.visible" title="指点跟随" width="300px" :show-close="false" class="hud-dialog"
               align-center>
      <div class="follow-form">
        <div class="form-item"><label>目标经度</label><span class="coord-val">{{
            followDialog.target.lng.toFixed(7)
          }}</span></div>
        <div class="form-item"><label>目标纬度</label><span class="coord-val">{{
            followDialog.target.lat.toFixed(7)
          }}</span></div>
        <div class="form-item input-item"><label>速度 (m/s)</label>
          <el-input-number v-model="followDialog.speed" :min="0.5" :max="5.0" :step="0.1" size="small"/>
        </div>
        <div class="form-item input-item"><label>朝向 (deg)</label>
          <el-input-number v-model="followDialog.heading" :min="0" :max="360" :step="5" size="small"/>
        </div>
      </div>
      <template #footer>
            <span class="dialog-footer">
            <el-button @click="followDialog.visible = false" class="hud-btn-cancel">取消</el-button>
            <el-button type="primary" @click="confirmFollow" class="hud-btn-confirm">执行</el-button>
            </span>
      </template>
    </el-dialog>

  </div>
</template>

<script setup>
import {computed, onUnmounted, ref, watch} from 'vue';
import {useGcsStore} from '../store/useGcsStore';
import {storeToRefs} from 'pinia';
import VirtualJoystick from '../components/Cockpit/VirtualJoystick.vue';
import {throttle} from 'lodash';
import {Aim, Bell, Link, Loading, VideoPause, VideoPlay} from '@element-plus/icons-vue';
import {ElMessage, ElMessageBox} from 'element-plus';

const store = useGcsStore();
const {vehicle, sysLogs, mission, mapTriggers} = storeToRefs(store);

// --- 状态变量 ---
const offboardSubMode = ref('STEADY');
const missionState = ref('EXECUTING');
const followDialog = ref({visible: false, target: {lat: 0, lng: 0}, speed: 1.5, heading: 0});

// 计算倒序日志（最新的在上面）
const reversedLogs = computed(() => {
  return [...(sysLogs.value || [])].reverse();
});

// --- 自动重连逻辑 (需求2) ---
let reconnectTimer = null;
watch(() => vehicle.value.connected, (connected) => {
  if (!connected) {
    if (!reconnectTimer) {
      console.log("Detect Offline, starting auto-reconnect...");
      reconnectTimer = setInterval(() => {
        store.sendPacket('CMD_CONNECT_VEHICLE');
      }, 3000); // 每3秒尝试重连
    }
  } else {
    if (reconnectTimer) {
      clearInterval(reconnectTimer);
      reconnectTimer = null;
      ElMessage.success("飞控已连接");
    }
  }
}, {immediate: true});

// --- 辅助计算 ---
const getBatColor = computed(() => vehicle.value.battery.percent > 0.3 ? '#67c23a' : '#f56c6c');
const currentWaypointIndex = computed(() => mission.value.progress.total > 0 ? mission.value.progress.current + 1 : 0);
const totalWaypoints = computed(() => mission.value.progress.total);
const missionProgress = computed(() => {
  const {total, current} = mission.value.progress;
  return total ? Math.min(Math.max((current / total) * 100, 0), 100) : 0;
});
const getLogLevelClass = (level) => {
  if (level.includes('ERROR') || level.includes('FAIL')) return 'log-error';
  if (level.includes('WARN')) return 'log-warn';
  return 'log-info';
};

// --- 动作逻辑 ---
const changeMode = (mode) => {
  store.sendPacket('CMD_SET_MODE', {mode: mode});
  if (mode === 'MISSION') missionState.value = 'EXECUTING';
};

const handleSubModeChange = (val) => {
  offboardSubMode.value = val;
  store.sendPacket('CMD_SET_OFFBOARD_SUBMODE', {submode: val});
  ElMessage.info(`切换至 ${val === 'STEADY' ? '稳态' : '特技'}模式`);
};

// 回到小船 (需求4)
const handleCenterMap = () => {
  // 假设 store 中有这个 trigger，BaseMap 会监听它
  store.mapTriggers.centerMap = true;

};

const controlMission = (action) => {
  store.sendPacket('CMD_MISSION_CONTROL', {action: action});
  if (action === 'PAUSE') missionState.value = 'PAUSED';
  if (action === 'RESUME') missionState.value = 'EXECUTING';
};

// 取消任务 (需求7后半部分)
const cancelMission = () => {
  ElMessageBox.confirm('确定要终止任务并悬停吗？', '终止任务', {
    confirmButtonText: '终止', cancelButtonText: '继续', type: 'warning',
    customClass: 'hud-message-box'
  }).then(() => {
    store.sendPacket('CMD_MISSION_CONTROL', {action: 'RESET'});
    // 2. 立即切换到 Offboard
    changeMode('OFFBOARD');
  });
};

const enableFollowMode = () => {
  ElMessage.success('请在地图上点击目标点');
  store.mapTriggers.isSelectingTarget = true;
};

watch(() => store.mapTriggers.selectedTarget, (newTarget) => {
  if (newTarget && store.mapTriggers.isSelectingTarget) {
    followDialog.value.target = newTarget;
    followDialog.value.visible = true;
    store.mapTriggers.isSelectingTarget = false;
  }
}, {deep: true});

const confirmFollow = () => {
  store.sendPacket('CMD_FOLLOW_TARGET', {
    lat: followDialog.value.target.lat, lng: followDialog.value.target.lng,
    speed: followDialog.value.speed, heading: followDialog.value.heading
  });
  followDialog.value.visible = false;
};

const sendArmCommand = (action, force) => {
  // ... 保持原有逻辑 ...
  const cmd = action === 'ARM' ? 'CMD_ARM' : 'CMD_DISARM';
  if (force) {
    ElMessageBox.confirm(`确定要强制 ${action} 吗？这极其危险！`, '危险操作', {
      confirmButtonText: '强制执行', cancelButtonText: '取消', type: 'error',
      customClass: 'hud-message-box'
    }).then(() => {
      store.sendPacket(cmd, {force: true});
    });
  } else {
    store.sendPacket(cmd, {force: false});
  }
};

const setHomePoint = () => {
  store.sendPacket('CMD_CUSTOM_ACTION', {action: 'SET_HOME_CURRENT'});
  ElMessage.success('已请求设为返航点');
};

// --- 摇杆逻辑 (复用) ---
const controlState = ref({x: 0.0, y: 0.0, z: 0.5, r: 0.0});
const sendControlCommand = throttle(() => {
  store.sendPacket("CMD_MANUAL_CONTROL", {
    x: controlState.value.x, y: controlState.value.y, z: 0.5, r: controlState.value.r
  });
}, 100);

const handleLeftStick = (vec) => {
  controlState.value.x = vec.y;
  sendControlCommand();
};
const resetLeftStick = () => {
  controlState.value.x = 0.0;
  sendControlCommand();
};
const handleRightStick = (vec) => {
  controlState.value.r = vec.x;
  sendControlCommand();
};
const resetRightStick = () => {
  controlState.value.r = 0.0;
  sendControlCommand();
};

onUnmounted(() => {
  sendControlCommand.cancel();
  if (reconnectTimer) clearInterval(reconnectTimer);
});
</script>

<style scoped>
/* 全屏容器，无边框 */
.view-container {
  width: 100vw;
  height: 100vh;
  position: fixed;
  top: 0;
  left: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 100;
}

/* ================== 顶部 HUD 栏 ================== */
.hud-top-bar {
  pointer-events: auto;
  position: absolute;
  top: 15px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 12px;
  background: rgba(20, 20, 20, 0.75);
  backdrop-filter: blur(12px);
  padding: 6px 16px;
  border-radius: 50px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
  z-index: 1000;
}

.divider {
  width: 1px;
  height: 24px;
  background: rgba(255, 255, 255, 0.15);
}

.hud-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0 8px;
  cursor: pointer;
  transition: all 0.2s;
  color: white;
}

.hud-item:hover {
  opacity: 0.8;
}

.icon-btn {
  flex-direction: row;
  gap: 5px;
  min-width: 40px;
}

.icon-btn .el-icon {
  font-size: 20px;
}

.hud-label {
  font-size: 9px;
  color: #888;
  text-transform: uppercase;
  margin-top: -2px;
}

.hud-label-mini {
  font-size: 10px;
  font-weight: bold;
}

.hud-value {
  font-family: 'DIN Alternate', 'Roboto Mono', monospace;
  font-size: 18px;
  font-weight: 700;
  line-height: 1;
}

small {
  font-size: 10px;
}

.mode-item {
  background: #409EFF;
  padding: 4px 12px;
  border-radius: 4px;
  flex-direction: row;
  gap: 8px;
}

.mode-item.disconnected {
  background: #5a5a5a;
  color: #aaa;
}

.col-flex {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.sub-mode-tag {
  font-size: 9px;
  background: rgba(0, 0, 0, 0.2);
  padding: 0 4px;
  border-radius: 2px;
  margin-top: 2px;
}

.arm-item {
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 4px 10px;
}

.arm-item.disarmed {
  border-color: #409EFF;
  color: #409EFF;
}

.arm-item.armed {
  background: rgba(245, 108, 108, 0.8);
  color: white;
  animation: pulse 2s infinite;
}

/* ================== 底部仪表盘容器 ================== */
.bottom-dashboard {
  pointer-events: auto;
  position: absolute;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%);
  width: 85%;
  max-width: 900px;
  height: 170px; /* 高度固定 */

  background: linear-gradient(to top, rgba(0, 0, 0, 0.95), rgba(0, 0, 0, 0.6));
  backdrop-filter: blur(12px);
  border-radius: 24px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);

  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 40px;
  z-index: 1000;
  overflow: hidden; /* 防止内容溢出 */
}

/* ================== OFFBOARD 模式样式 ================== */

/* 摇杆区域 - 垂直居中，不再偏移 */
.stick-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  width: 140px;
  /* 移除 top: -20px，让 flex 自动居中 */
}

.stick-name {
  font-size: 10px;
  color: #555;
  font-weight: bold;
  letter-spacing: 1px;
}
/* 修改 joystick-box：作为整体容器 */
.joystick-box {
      display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 140px;
    height: 170px;
    /* background: rgba(0, 0, 0, 0.3); */
    padding: 10px;
    border-radius: 20px;
    /* backdrop-filter: blur(5px); */
    box-sizing: border-box;
}

/* 新增：摇杆的专属区域 */
.joystick-field {
  width: 100%;
  flex: 1; /* 关键：占据除文字外的所有剩余空间 */
  position: relative; /* 建立定位基准，让 NippleJS 相对于这个框居中 */
  min-height: 120px; /* 保证摇杆有足够的操作空间 */
}

/* 调整文字样式 */
.stick-label {
  margin-top: 5px; /* 与摇杆拉开一点距离 */
  font-size: 12px;
  color: #ccc;
  font-weight: bold;
  text-transform: uppercase;
  letter-spacing: 1px;
  /* 确保文字不会拦截点击，但在 flex 布局下通常不需要 */
  pointer-events: none;
}
/* 中间控制面板 */
.center-panel {
  flex: 1;
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
}

.manual-controls {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.mode-switch-group {
  display: flex;
  background: rgba(0, 0, 0, 0.5);
  border-radius: 8px;
  padding: 4px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  margin-bottom: 8px;
}

.switch-item {
  padding: 8px 30px;
  font-size: 14px;
  color: #888;
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.3s;
  font-weight: bold;
}

.switch-item.active {
  background: #333;
  color: #409EFF;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
}

.control-hint {
  font-size: 12px;
  color: #666;
}


/* ================== MISSION 模式样式 (新布局) ================== */

.mission-dashboard {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  /* 移除 padding，因为外层容器已有 padding */
}

/* 左右侧按钮容器 */
.mission-side-btn {
  width: 160px;
  display: flex;
  justify-content: center;
  align-items: center;
}

/* 通用大按钮样式 */
.hud-action-btn {
  width: 100%;
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.hud-action-btn:active {
  transform: scale(0.96);
}

.hud-action-btn .el-icon {
  font-size: 24px;
}

.btn-text {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  line-height: 1.2;
}

.btn-text .main-text {
  font-size: 16px;
  font-weight: bold;
  color: white;
}

.btn-text .sub-text {
  font-size: 9px;
  font-weight: bold;
  opacity: 0.6;
  letter-spacing: 1px;
}

/* 暂停样式 (黄色背景) */
.btn-pause {
  background: rgba(230, 162, 60, 0.2);
  border-color: rgba(230, 162, 60, 0.4);
  color: #e6a23c;
}

.btn-pause:hover {
  background: rgba(230, 162, 60, 0.35);
  box-shadow: 0 0 15px rgba(230, 162, 60, 0.2);
}

/* 继续样式 (绿色背景) */
.btn-resume {
  background: rgba(103, 194, 58, 0.2);
  border-color: rgba(103, 194, 58, 0.4);
  color: #67c23a;
  animation: pulse-border-green 2s infinite;
}

.btn-resume:hover {
  background: rgba(103, 194, 58, 0.35);
}

/* 取消/中止样式 (红色背景) */
.btn-abort {
  background: rgba(245, 108, 108, 0.2);
  border-color: rgba(245, 108, 108, 0.4);
  color: #f56c6c;
}

.btn-abort:hover {
  background: rgba(245, 108, 108, 0.35);
  box-shadow: 0 0 15px rgba(245, 108, 108, 0.2);
}

.btn-abort .main-text {
  color: #f56c6c;
}

/* 中间状态显示 */
.mission-center-stat {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0 40px;
}

.wp-counter {
  margin-bottom: 10px;
  text-align: center;
}

.wp-counter .label {
  display: block;
  font-size: 10px;
  color: #666;
  letter-spacing: 3px;
  margin-bottom: 2px;
}

.wp-counter .val {
  font-family: 'DIN Alternate', sans-serif;
  font-size: 28px;
  color: white;
}

.wp-counter .divider {
  color: #444;
  font-size: 20px;
  margin: 0 4px;
  background: none;
}

.mission-progress-bar {
  width: 100%;
  height: 8px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  overflow: hidden;
  position: relative;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #409EFF, #36d1dc);
  position: relative;
  transition: width 0.3s ease;
  box-shadow: 0 0 10px rgba(64, 158, 255, 0.5);
}

.glow-head {
  position: absolute;
  right: 0;
  top: 0;
  height: 100%;
  width: 5px;
  background: white;
  box-shadow: 0 0 5px white;
  opacity: 0.8;
}

.mission-status-text {
  margin-top: 8px;
  font-size: 12px;
  color: #aaa;
}


/* ================== 通用动画与杂项 ================== */
.offline-mask {
  pointer-events: auto;
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 2000;
}

.offline-box {
  text-align: center;
  color: white;
}

.rotating-slow {
  animation: rotate 3s linear infinite;
  font-size: 40px;
  margin-bottom: 10px;
}

/* 日志弹窗 */
.log-popover .terminal-body {
  max-height: 300px;
  overflow-y: auto;
  font-family: monospace;
  font-size: 11px;
  background: #111;
  padding: 10px;
  border-radius: 4px;
}

.log-line {
  margin-bottom: 3px;
  border-bottom: 1px solid #222;
  padding-bottom: 2px;
}

.log-time {
  color: #555;
  margin-right: 5px;
}

.log-text {
  color: #ccc;
}

.log-error .log-text {
  color: #f56c6c;
}

.log-warn .log-text {
  color: #e6a23c;
}

/* 动画定义 */
.slide-up-enter-active, .slide-up-leave-active {
  transition: all 0.5s cubic-bezier(0.19, 1, 0.22, 1);
}

.slide-up-enter-from, .slide-up-leave-to {
  transform: translate(-50%, 100%);
  opacity: 0;
}

@keyframes rotate {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@keyframes pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(245, 108, 108, 0.7);
  }
  70% {
    box-shadow: 0 0 0 10px rgba(0, 0, 0, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(0, 0, 0, 0);
  }
}

@keyframes pulse-border-green {
  0% {
    border-color: rgba(103, 194, 58, 0.4);
  }
  50% {
    border-color: rgba(103, 194, 58, 1);
  }
  100% {
    border-color: rgba(103, 194, 58, 0.4);
  }
}

/* 弹窗表单 */
.follow-form {
  display: flex;
  flex-direction: column;
  gap: 15px;
  padding: 10px 0;
}

.form-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: #ddd;
  font-size: 14px;
}

.coord-val {
  font-family: 'Consolas', monospace;
  color: #409EFF;
}
</style>

<style>
.hud-popover.el-popover {
  background: rgba(20, 20, 20, 0.95) !important;
  border: 1px solid #444 !important;
  color: #eee !important;
  backdrop-filter: blur(10px);
  padding: 12px !important;
}

.hud-popover .el-popper__arrow::before {
  background: rgba(20, 20, 20, 0.95) !important;
  border-color: #444 !important;
}

.popover-content h4 {
  margin: 0 0 10px 0;
  color: #888;
  font-size: 10px;
  letter-spacing: 1px;
}

.popover-content p {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: #ccc;
  margin: 4px 0;
}

.highlight {
  color: #409EFF;
  font-weight: bold;
}

.mode-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.mode-btn {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #ccc;
  padding: 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
}

.mode-btn:hover {
  background: #409EFF;
  border-color: #409EFF;
  color: white;
}

.mode-btn.danger {
  color: #f56c6c;
  border-color: rgba(245, 108, 108, 0.3);
}

.mode-btn.danger:hover {
  background: #f56c6c;
  color: white;
}

.mode-btn.success {
  color: #67c23a;
  border-color: rgba(103, 194, 58, 0.3);
}

.mode-btn.success:hover {
  background: #67c23a;
  color: white;
}

/* 消息框的 badge 颜色 */
.log-badge .el-badge__content {
  background-color: #f56c6c;
  border: none;
}
</style>