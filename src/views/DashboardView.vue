<template>
  <div class="view-container">

    <div class="hud-top">
      <div class="hud-box">
        <span class="label">SPEED</span>
        <span class="value">{{ vehicle.velocity.speed }} m/s</span>
      </div>
      <div class="hud-box">
        <span class="label">HEADING</span>
        <span class="value">{{ vehicle.attitude.yaw }}°</span>
      </div>
      <div class="hud-box warning" v-if="!vehicle.connected">
        <span>⚠️ DISCONNECTED</span>
      </div>
    </div>

    <transition name="fade">
      <div class="controls-layer" v-show="vehicle.mode === 'MANUAL'">

        <div class="joystick-container">
          <div class="joystick-wrapper">
            <VirtualJoystick @update="handleLeftStick" @end="resetLeftStick" />
          </div>
          <div class="stick-label">THROTTLE</div>
        </div>

        <div class="joystick-container">
          <div class="joystick-wrapper">
            <VirtualJoystick @update="handleRightStick" @end="resetRightStick" />
          </div>
          <div class="stick-label">STEER</div>
        </div>

      </div>
    </transition>

    <div class="mode-mask" v-if="vehicle.mode !== 'MANUAL'">
      <h2>当前模式: {{ vehicle.mode }}</h2>
      <p>如需控制，请切换至 MANUAL 模式</p>
      <el-button
        type="primary"
        style="margin-top: 15px"
        @click="store.sendPacket('CMD_SET_MODE', { mode: 'MANUAL' })"
      >
        切换到 MANUAL
      </el-button>
    </div>

  </div>
</template>

<script setup>
// JS 逻辑保持不变，不需要修改
import { ref, onUnmounted } from 'vue';
import { useGcsStore } from '../store/useGcsStore';
import { storeToRefs } from 'pinia';
import VirtualJoystick from '../components/Cockpit/VirtualJoystick.vue';
import { throttle } from 'lodash';

const store = useGcsStore();
const { vehicle } = storeToRefs(store);

const controlState = ref({ x: 0.0, y: 0.0, z: 0.5, r: 0.0 });

const sendControlCommand = throttle(() => {
  // 这里的键名要和 Python 后端 receive 逻辑一致 (x, y, z, r)
  store.sendPacket("CMD_MANUAL_CONTROL", {
    x: controlState.value.x, // 前后
    y: 0.0,                  // 左右平移 (船通常不用)
    z: 0.5,                  // 油门 (MAVLink标准，通常0.5是中位)
    r: controlState.value.r  // 转向
  });

  // console.log(`SEND -> x:${controlState.value.x}, r:${controlState.value.r}`);
}, 100); // 10Hz


const handleLeftStick = (vec) => { controlState.value.x = vec.y; sendControlCommand(); };
const resetLeftStick = () => { controlState.value.x = 0.0; sendControlCommand(); };
const handleRightStick = (vec) => { controlState.value.r = vec.x; sendControlCommand(); };
const resetRightStick = () => { controlState.value.r = 0.0; sendControlCommand(); };

onUnmounted(() => { sendControlCommand.cancel(); });
</script>

<style scoped>
.view-container {
  width: 100%; height: 100%; position: relative; pointer-events: none; overflow: hidden;
}

/* --- HUD 通用样式 --- */
.hud-box {
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(8px);
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: white;
  text-align: center;
  min-width: 80px;
  box-shadow: 0 4px 6px rgba(0,0,0,0.3);
}

.hud-top {
  position: absolute; top: 20px; left: 50%; transform: translateX(-50%);
  display: flex; gap: 15px; pointer-events: auto;
}
.label { display: block; font-size: 10px; color: #ccc; margin-bottom: 2px; }
.value { font-size: 20px; font-family: 'Courier New', monospace; font-weight: bold; }
.hud-box.warning { border-color: #f56c6c; color: #f56c6c; }

/* --- 底部控制层 --- */
.controls-layer {
  position: absolute;
  bottom: 0; left: 0; width: 100%; height: 260px;
  padding: 0 40px 60px 40px; /* 调整 Padding */
  box-sizing: border-box;
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  pointer-events: none;
}

/* --- 摇杆容器 (整体 HUD 风格) --- */
.joystick-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;

  /* 这里的样式实现了你想要的效果：加到 container 上 */
  background: rgba(0, 0, 0, 0.5); /* 半透明黑底 */
  backdrop-filter: blur(10px);    /* 强磨砂效果 */
  padding: 20px;                  /* 你的要求：20px Padding */
  border-radius: 24px;            /* 圆角大一点，像个面板 */
  border: 1px solid rgba(255, 255, 255, 0.1); /* 微微的边框 */
  box-shadow: 0 8px 20px rgba(0,0,0,0.4);

  pointer-events: auto; /* 允许触摸 */
  transition: transform 0.2s;
}

.joystick-wrapper {
  width: 120px;
  height: 120px;
  /* 内部背景去掉或减淡，因为外层已经有背景了 */
  position: relative;
}

.stick-label {
  color: #ddd;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  /* 去掉了之前的 hud-box 样式，现在只是纯文字 */
}

.mode-mask {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  text-align: center; color: rgba(255,255,255,0.7); pointer-events: none;
  background: rgba(0,0,0,0.4); padding: 20px; border-radius: 10px;
}

.fade-enter-active, .fade-leave-active { transition: opacity 0.3s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>