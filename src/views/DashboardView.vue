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

      <ConnectionManager/>

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
            <button class="mode-btn" @click="changeMode('OFFBOARD')">地面控制</button>
            <button class="mode-btn" @click="changeMode('MISSION')" :disabled="mission.plannedWaypoints.length === 0">
              自动任务
            </button>
            <button class="mode-btn" @click="changeMode('HOLD')">暂停模式</button>
            <button class="mode-btn" @click="changeMode('RTL')">前往目标</button>
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
          <el-button type="primary" size="small" style="width: 100%" @click="setHomePoint">
            设为返航点
          </el-button>
        </div>
      </el-popover>

      <el-popover placement="bottom" :width="200" trigger="hover" popper-class="hud-popover">
        <template #reference>
          <div class="hud-item bat-item-hud" :class="{ 'bat-alarm': hasBatAlarms }">
            <span class="hud-value" :style="{color: hasBatAlarms ? '#fff' : getBatColor}">
              {{ vehicle.battery.remaining_percent ?? 0 }}<small>%</small>
            </span>
            <span class="hud-label">BAT</span>
          </div>
        </template>
        <div class="popover-content">
          <h4>电源状态</h4>
          <div class="bat-detail-grid">
            <div class="bat-item">
              <el-icon>
                <Lightning/>
              </el-icon>
              <span>{{ (vehicle.battery.voltage_v ?? 0).toFixed(2) }} V</span>
            </div>
            <div class="bat-item">
              <el-icon>
                <Odometer/>
              </el-icon>
              <span>{{ (vehicle.battery.current_a ?? 0).toFixed(1) }} A</span>
            </div>
            <div class="bat-item">
              <el-icon>
                <Sunny/>
              </el-icon> <!-- 用 Sunny 代替温度图标 -->
              <span>{{ (vehicle.battery.temperature ?? 0).toFixed(1) }} °C</span>
            </div>
          </div>
          <div v-if="vehicle.battery.alarms && vehicle.battery.alarms.length > 0" class="bat-alarms">
            <span v-for="alarm in vehicle.battery.alarms" :key="alarm" class="alarm-tag">{{ alarm }}</span>
          </div>

          <el-divider style="margin: 10px 0; border-color: #555"/>

          <div class="bat-settings">
            <div class="form-item">
              <label>低电量阈值 (%)</label>
              <el-input-number
                  v-model="vehicle.battery.low_battery_threshold"
                  :min="5" :max="50" :step="1"
                  size="small"
                  style="width: 90px"
                  @change="updateBatThreshold"
              />
            </div>
            <div class="bat-status-row" v-if="vehicle.battery.is_low_battery_rtl_triggered">
              <span class="status-tag warning">低电量返航中</span>
            </div>
          </div>
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
            <button class="mode-btn success" @click="sendArmCommand('ARM', false)">解锁</button>
            <button class="mode-btn warning" @click="sendArmCommand('DISARM', false)">上锁</button>
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

      <!-- 新增清除轨迹按钮 -->
      <div class="hud-item icon-btn" @click="store.clearTrajectory" title="清除轨迹">
        <el-icon>
          <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="16" height="16">
            <path fill="currentColor"
                  d="M896 160H704a32 32 0 0 0-32 32v96h-448V192a32 32 0 0 0-32-32H128a32 32 0 0 0-32 32v160h768V192a32 32 0 0 0-32-32zM128 416v480a32 32 0 0 0 32 32h608a32 32 0 0 0 32-32V416H128zm352 320a32 32 0 0 1-32 32h-96a32 32 0 0 1-32-32V544a32 32 0 0 1 32-32h96a32 32 0 0 1 32 32v192zm192 0a32 32 0 0 1-32 32h-96a32 32 0 0 1-32-32V544a32 32 0 0 1 32-32h96a32 32 0 0 1 32 32v192z"></path>
          </svg>
        </el-icon>
        <span class="hud-label-mini">清迹</span>
      </div>

    </div>

    <!-- 新增工具栏 -->
    <div class="accessory-bar">
      <div
          class="hud-item relay-item"
          :class="{ 'active': vehicle.relay_on }"
          @click="store.setRelay(!vehicle.relay_on)"
      >
        <span class="hud-label-mini">特种混合器: {{ vehicle.relay_on ? '开' : '关' }}</span>
      </div>
    </div>


    <transition name="slide-up">
      <div class="bottom-dashboard" v-if="vehicle.connected && ['OFFBOARD', 'MISSION'].includes(vehicle.mode)">

        <template v-if="vehicle.mode === 'OFFBOARD'">
          <div class="joystick-box left">
            <div class="joystick-field">
              <VirtualJoystick @update="handleLeftStick" @end="resetLeftStick" lockY/>
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
              <VirtualJoystick @update="handleRightStick" @end="resetRightStick" lockX/>
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
              <div class="manual-wp-jump">
                <el-input-number
                    v-model="manualWaypointIndex"
                    :min="1"
                    :max="totalWaypoints"
                    size="small"
                    controls-position="right"
                    placeholder="航点"
                />
                <button class="jump-btn" @click="jumpToWaypoint">跳转</button>
              </div>

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

    <el-dialog v-model="gotoDialog.visible" title="目标设定" width="320px" :show-close="false" class="hud-dialog"
               align-center append-to-body>
      <div class="follow-form">
        <div class="form-item"><label>目标经度</label><span class="coord-val">{{
            gotoDialog.target.lng.toFixed(7)
          }}</span></div>
        <div class="form-item"><label>目标纬度</label><span class="coord-val">{{
            gotoDialog.target.lat.toFixed(7)
          }}</span></div>
      </div>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="gotoDialog.visible = false" class="hud-btn-cancel">取消</el-button>
          <el-button type="primary" @click="confirmGoto" class="hud-btn-confirm">确认</el-button>
        </span>
      </template>
    </el-dialog>

    <!-- 任务启动确认弹窗 -->
    <el-dialog v-model="missionStartDialog.visible" title="启动自动任务" width="380px" :show-close="false"
               class="hud-dialog"
               align-center append-to-body>
      <div class="mission-start-form">
        <div class="safety-check-item">
          <span class="label">低电量阈值</span>
          <span class="value warning">{{ vehicle.battery.low_battery_threshold }}%</span>
        </div>
        <div class="safety-check-item">
          <span class="label">返航点 (HOME)</span>
          <span class="value success" v-if="vehicle.home">
                {{ vehicle.home.lat.toFixed(6) }}, {{ vehicle.home.lon.toFixed(6) }}
            </span>
          <span class="value error" v-else>无效</span>
        </div>

        <el-divider style="margin: 15px 0; border-color: #444"/>

        <div class="form-item-row">
          <label>起始航点 (Seq)</label>
          <el-input-number
              v-model="missionStartDialog.startIndex"
              :min="1"
              :max="totalWaypoints"
              size="default"
              controls-position="right"
              style="width: 120px;"
          />
        </div>
        <div class="hint-text">
          总航点数: {{ totalWaypoints }}
        </div>
      </div>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="missionStartDialog.visible = false" class="hud-btn-cancel">取消</el-button>
          <el-button type="primary" @click="confirmMissionStart" class="hud-btn-confirm">确认并开始</el-button>
        </span>
      </template>
    </el-dialog>

  </div>
</template>

<script setup>
import {computed, onMounted, onUnmounted, ref, watch} from 'vue';
import {useGcsStore} from '../store/useGcsStore';
import {storeToRefs} from 'pinia';
import VirtualJoystick from '../components/Cockpit/VirtualJoystick.vue';
import ConnectionManager from '../components/Common/ConnectionManager.vue';
import {
  Aim,
  Bell,
  Lightning,
  Link,
  Loading,
  Odometer,
  Sunny,
  SwitchButton,
  VideoPause,
  VideoPlay
} from '@element-plus/icons-vue';
import {ElMessageBox, ElNotification} from 'element-plus';

const store = useGcsStore();
const {vehicle, sysLogs, mission, mapTriggers} = storeToRefs(store);

// --- 状态变量 ---
const offboardSubMode = ref('STEADY');
const missionState = ref('EXECUTING');
const gotoDialog = ref({visible: false, target: {lat: 0, lng: 0}, heading: 0});
const manualWaypointIndex = ref(1);
const missionStartDialog = ref({visible: false, startIndex: 1});

// 计算倒序日志（最新的在上面）
const reversedLogs = computed(() => {
  return [...(sysLogs.value || [])].reverse();
});

// --- 自动重连逻辑 ---
let reconnectTimer = null;
watch(() => vehicle.value.connected, (connected) => {
  if (!connected) {
    if (!reconnectTimer) {
      reconnectTimer = setInterval(() => store.sendPacket('CMD_CONNECT_VEHICLE'), 3000);
    }
  } else {
    if (reconnectTimer) {
      clearInterval(reconnectTimer);
      reconnectTimer = null;
      ElNotification.success({title: '系统消息', message: '飞控已连接'});
    }
    // 飞控连接成功后：
    // 1. 下载任务
    store.sendPacket("CMD_DOWNLOAD_MISSION", {});
    // 2. 聚焦地图到飞控位置
    store.mapTriggers.centerMap = true;
  }
}, {immediate: true});

// --- 辅助计算 ---
const getBatColor = computed(() => {
  if (vehicle.value.battery.remaining_percent <= vehicle.value.battery.low_battery_threshold) {
    return '#f56c6c';
  }
  return vehicle.value.battery.remaining_percent > 30 ? '#67c23a' : '#e6a23c';
});

const hasBatAlarms = computed(() => {
  const hasHardwareAlarms = vehicle.value.battery.alarms && vehicle.value.battery.alarms.length > 0;
  const isLowBat = vehicle.value.battery.remaining_percent <= vehicle.value.battery.low_battery_threshold;
  return hasHardwareAlarms || isLowBat;
});

const currentWaypointIndex = computed(() => mission.value.progress.total > 0 ? mission.value.progress.current + 1 : 0);
const totalWaypoints = computed(() => mission.value.progress.total);
const missionProgress = computed(() => {
  const {total, current} = mission.value.progress;
  return total > 0 ? Math.min(((current + 1) / total) * 100, 100) : 0;
});
const getLogLevelClass = (level) => {
  if (level.includes('ERROR') || level.includes('FAIL')) return 'log-error';
  if (level.includes('WARN')) return 'log-warn';
  return 'log-info';
};

// --- 动作逻辑 ---
const changeMode = (mode, payload_extra = {}) => {
  if (mode === 'MISSION') {
    if (mission.value.plannedWaypoints.length === 0) {
      ElNotification.warning({title: '操作提示', message: "飞控上无任务，无法切换到任务模式"});
      return;
    }

    // 检查 Home 点是否有效
    if (!vehicle.value.health || !vehicle.value.health.is_home_position_ok) {
      ElNotification.error({title: '安全检查失败', message: "Home点无效，无法进入任务模式！请先设置返航点。"});
      return;
    }

    // 检查是否解锁 (ARMED)
    if (!vehicle.value.armed) {
      ElMessageBox.alert(
          '车辆当前处于上锁状态，无法执行自动任务。\n请先切换至 暂停模式 并解锁车辆，再尝试进入任务模式。',
          '无法进入任务',
          {
            confirmButtonText: '知道了',
            type: 'error',
            customClass: 'hud-message-box'
          }
      );
      return;
    }

    // 打开配置对话框
    let defaultStart = 1;
    if (mission.value.progress.current >= 0 && mission.value.progress.current < mission.value.progress.total) {
      defaultStart = mission.value.progress.current + 1;
    }
    missionStartDialog.value.startIndex = defaultStart;
    missionStartDialog.value.visible = true;

  } else {
    executeChangeMode(mode, payload_extra);
  }
};

const confirmMissionStart = () => {
  const targetIndex = missionStartDialog.value.startIndex - 1;
  executeChangeMode('MISSION', {mission_item_index: targetIndex});
  missionStartDialog.value.visible = false;
};

const executeChangeMode = (mode, payload_extra) => {
  let payload = {mode: mode, ...payload_extra};

  if (mode === 'MISSION' && missionState.value === 'PAUSED' && !payload.mission_item_index) {
    if (mission.value.progress && mission.value.progress.total > 0) {
      let nextIndex = mission.value.progress.current;
      if (nextIndex < mission.value.progress.total) {
        payload.mission_item_index = mission.value.progress.current || 0;
      }
    }
  }

  store.sendPacket('CMD_SET_MODE', payload);
  if (mode === 'MISSION') {
    missionState.value = 'EXECUTING';
    // 延时2秒开启特种混合器
    setTimeout(() => {
      store.setRelay(1);
      ElNotification.success({title: '系统消息', message: '特种混合器已开启'});
    }, 2000);
  } else if (mode === 'HOLD') {
    // 进入 HOLD 模式，关闭特种混合器
    store.setRelay(0);
    sendArmCommand("DISARM")
    ElNotification.info({title: '系统消息', message: '特种混合器已关闭'});
  }
}

const jumpToWaypoint = () => {
  if (manualWaypointIndex.value > 0 && manualWaypointIndex.value <= totalWaypoints.value) {
    ElMessageBox.confirm(`确定要跳转到航点 ${manualWaypointIndex.value} 吗？`, '航点跳转', {
      confirmButtonText: '确定', cancelButtonText: '取消', type: 'warning',
      customClass: 'hud-message-box'
    }).then(() => {
      const targetIndex = manualWaypointIndex.value - 1;
      changeMode('MISSION', {mission_item_index: targetIndex});
      ElNotification.success({title: '指令发送', message: `已发送指令，跳转到航点 ${manualWaypointIndex.value}`});
    });
  } else {
    ElNotification.error({title: '错误', message: '无效的航点索引'});
  }
};

const handleSubModeChange = (val) => {
  offboardSubMode.value = val;
  store.sendPacket('CMD_SET_OFFBOARD_SUBMODE', {submode: val});
  ElNotification.info({title: '模式切换', message: `切换至 ${val === 'STEADY' ? '稳态' : '特技'}模式`});
};

const handleCenterMap = () => {
  store.mapTriggers.centerMap = true;
};

const controlMission = (action) => {
  if (action === 'RESUME') {
    changeMode('MISSION');
    return;
  }
  store.sendPacket('CMD_MISSION_CONTROL', {action: action});
  if (action === 'PAUSE') {
    missionState.value = 'PAUSED';
    sendArmCommand("DISARM")
    store.setRelay(0)
  }
};

const cancelMission = () => {
  ElMessageBox.confirm('确定要终止任务并悬停吗？', '终止任务', {
    confirmButtonText: '终止', cancelButtonText: '继续', type: 'warning',
    customClass: 'hud-message-box'
  }).then(() => {
    store.sendPacket('CMD_MISSION_CONTROL', {action: 'RESET'});
    changeMode('OFFBOARD');
    store.setRelay(0)
  });
};

// --- 指点模式逻辑 ---
watch(() => mapTriggers.value.gotoTargetCandidate, (newTarget) => {
  if (newTarget) {
    gotoDialog.value.target = newTarget;
    gotoDialog.value.visible = true;
    // 清除候选，防止重复触发
    store.setGotoTargetCandidate(null);
  }
}, {deep: true});

const confirmGoto = () => {
  store.sendPacket('CMD_SET_HOME', {
    lat: gotoDialog.value.target.lat,
    lon: gotoDialog.value.target.lng,
    alt: 0
  });
  gotoDialog.value.visible = false;
  ElNotification.info({title: '指令发送', message: "在飞行任务中点击前往目标，执行命令"});
};


const sendArmCommand = (action, force) => {
  const cmd = action === 'ARM' ? 'CMD_ARM' : 'CMD_DISARM';
  console.log('sendArmCommand', action);
  console.log('mode', vehicle.mode);
  if (vehicle.value.mode === 'HOLD' && action === 'ARM' ) {
    ElNotification.error({title: '切换失败', message: '无法在HOLD模式下解锁'});
  } else {
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
  }
};

const setHomePoint = () => {
  if (vehicle.value.position && vehicle.value.position.lat) {
    store.setHome(vehicle.value.position.lat, vehicle.value.position.lng, vehicle.value.position.alt || 0);
    ElNotification.success({title: '设置成功', message: '已请求将当前位置设为返航点'});
  } else {
    ElNotification.warning({title: '设置失败', message: '无法获取当前位置，无法设置返航点'});
  }
};

const updateBatThreshold = (val) => {
  // 发送指令给下位机同步阈值
  store.sendPacket('CMD_SET_BATTERY_THRESHOLD', {threshold: val});
  ElNotification.info({title: '设置更新', message: `低电量阈值已更新为 ${val}%`});
};

// --- 摇杆逻辑 ---
const controlState = ref({throttle: 0.0, steering: 0.0});
const targetYaw = ref(0.0);
let controlLoop = null;

const GAINS = {
  STEADY_YAW_RATE: 30.0,
  STEADY_THRUST: 1.0,
  ACRO_VX: 1.0,
  ACRO_YAW_RATE: 6.0
};

onMounted(() => {
  controlLoop = setInterval(() => {
    if (vehicle.value.mode === 'OFFBOARD') {
      const dt = 0.1;
      const lx = controlState.value.throttle;
      const rx = controlState.value.steering;
      let packet = {};
      if (offboardSubMode.value === 'STEADY') {
        targetYaw.value += rx * GAINS.STEADY_YAW_RATE * dt;
        packet = {x: 0.0, y: 0.0, z: lx * GAINS.STEADY_THRUST, r: targetYaw.value};
      } else {
        targetYaw.value = vehicle.value.attitude.yaw;
        packet = {x: lx * GAINS.ACRO_VX, y: 0.0, z: 0.0, r: rx * GAINS.ACRO_YAW_RATE};
      }
      store.sendPacket("CMD_MANUAL_CONTROL", packet);
    } else {
      if (vehicle.value.attitude) {
        targetYaw.value = vehicle.value.attitude.yaw;
      }
    }
  }, 100);
});

// 节流函数，防止频繁弹窗
const throttleNotify = (() => {
  let lastTime = 0;
  return (msg) => {
    const now = Date.now();
    if (now - lastTime > 5000) { // 2秒内只提示一次
      ElNotification.warning({title: '安全警告', message: msg});
      lastTime = now;
    }
  };
})();

// 低电量报警逻辑
watch(() => vehicle.value.battery.is_low_battery_rtl_triggered, (newVal) => {
  if (newVal) {
    throttleNotify(`低电量报警！电量低于 ${vehicle.value.battery.low_battery_threshold}%，正在触发返航！`);
    // 强制关闭混合搅拌器
    if (vehicle.value.relay_on) {
      store.setRelay(0);
      ElNotification.warning({title: '系统保护', message: '低电量返航触发，已强制关闭混合搅拌器'});
    }
    // 如果当前模式不是 RTL 或 HOLD，则发送 RTL 指令
    if (vehicle.value.mode !== 'RTL' && vehicle.value.mode !== 'HOLD') {
      changeMode('RTL');
      ElNotification.warning({title: '系统保护', message: '低电量触发，自动切换至返航模式 (RTL)'});
    }
  }
});

// 持续监控电量，如果低于阈值也报警（双重保险，或者用于本地触发）
let batCheckTimer = null;
onMounted(() => {
  batCheckTimer = setInterval(() => {
    if (!vehicle.value.connected) return;

    if (vehicle.value.battery.is_low_battery_rtl_triggered) {
      throttleNotify(`系统警告：低电量返航保护已触发！`);
    } else if (vehicle.value.battery.remaining_percent <= vehicle.value.battery.low_battery_threshold) {
      throttleNotify(`注意：当前电量 ${vehicle.value.battery.remaining_percent}% 低于阈值 ${vehicle.value.battery.low_battery_threshold}%`);
    }
  }, 5000);
});

onUnmounted(() => {
  if (batCheckTimer) clearInterval(batCheckTimer);
});


const handleLeftStick = (vec) => {
  if (!vehicle.value.armed) {
    throttleNotify('请先解锁 (ARM) 车辆才能控制油门！');
    controlState.value.throttle = 0.0; // 强制归零
    return;
  }
  controlState.value.throttle = vec.y;
};
const resetLeftStick = () => {
  controlState.value.throttle = 0.0;
};

const handleRightStick = (vec) => {
  if (!vehicle.value.armed) {
    throttleNotify('请先解锁 (ARM) 车辆才能控制转向！');
    controlState.value.steering = 0.0; // 强制归零
    return;
  }
  controlState.value.steering = vec.x;
};
const resetRightStick = () => {
  controlState.value.steering = 0.0;
};

onUnmounted(() => {
  if (controlLoop) clearInterval(controlLoop);
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
  z-index: 2001;
}

/* ================== 新增工具栏 ================== */
.accessory-bar {
  pointer-events: auto;
  position: absolute;
  top: 68px; /* 位于主HUD下方 */
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  height: 30px;
  background: rgba(20, 20, 20, 0.7);
  backdrop-filter: blur(10px);
  padding: 4px 10px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
}

.relay-item {
  padding: 6px 12px;
  border-radius: 8px;
  background: rgba(255, 51, 51, 0.94);
  color: #ccc;
  transition: all 0.3s;
}

.relay-item.active {
  background: #67c23a;
  color: white;
  box-shadow: 0 0 10px rgba(103, 194, 58, 0.5);
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
  min-width: 55px;
}

.icon-btn .el-icon {
  font-size: 20px;
}

.hud-label {
  font-size: 9px;
  text-transform: uppercase;
  margin-top: -2px;
}

.hud-label-mini {
  font-size: 15px;
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
  padding: 0 20px;
}

.wp-counter {
  margin-bottom: 8px;
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
  margin-bottom: 8px;
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
  font-size: 12px;
  color: #aaa;
}

/* 新增：手动航点跳转样式 */
.manual-wp-jump {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px; /* 与下方内容拉开距离 */
  background: rgba(0, 0, 0, 0.3);
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.manual-wp-jump .el-input-number {
  width: 90px;
}

.manual-wp-jump .jump-btn {
  background: #409EFF;
  color: white;
  border: none;
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  font-weight: bold;
  transition: all 0.2s;
}

.manual-wp-jump .jump-btn:hover {
  background: #66b1ff;
  transform: scale(1.05);
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

/* 电池详情样式 */
.bat-detail-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 8px;
}

.bat-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #ddd;
}

.bat-item .el-icon {
  font-size: 16px;
  color: #409EFF;
}

.bat-alarms {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.alarm-tag {
  background: #f56c6c;
  color: white;
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
}

/* BAT HUD Item Styles */
.bat-item-hud {
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 4px 10px;
  transition: all 0.3s;
}

.bat-item-hud.bat-alarm {
  background: rgba(245, 108, 108, 0.8);
  color: white;
  animation: pulse 2s infinite;
  border-color: #f56c6c;
}

/* 电池设置区域 */
.bat-settings {
  margin-top: 10px;
}

.bat-status-row {
  margin-top: 8px;
  display: flex;
  justify-content: center;
}

.status-tag {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: bold;
}

.status-tag.warning {
  background: #e6a23c;
  color: white;
  animation: pulse 1s infinite;
}

/* 任务启动弹窗样式 */
.mission-start-form {
  padding: 5px 10px;
}

.safety-check-item {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 14px;
  color: #ccc;
}

.safety-check-item .value {
  font-family: 'Consolas', monospace;
  font-weight: bold;
}

.safety-check-item .value.warning {
  color: #e6a23c;
}

.safety-check-item .value.success {
  color: #67c23a;
}

.safety-check-item .value.error {
  color: #f56c6c;
}

.form-item-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 5px;
  color: #eee;
}

.hint-text {
  text-align: right;
  font-size: 12px;
  color: #888;
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

.mode-btn:disabled {
  background: rgba(255, 255, 255, 0.02);
  color: #666;
  cursor: not-allowed;
  border-color: rgba(255, 255, 255, 0.05);
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

.hud-message-box {
  white-space: pre-wrap;
}
</style>