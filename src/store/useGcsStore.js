import {defineStore} from 'pinia'
import {reactive} from 'vue'
import {ElMessage, ElNotification} from 'element-plus'

export const useGcsStore = defineStore('gcs', () => {
    // --- 1. 车辆状态 ---
    const vehicle = reactive({
        connected: false,
        armed: false,
        mode: 'UNKNOWN',
        battery: {voltage: 0, percent: 0, current: 0},
        gps: {sats: 0, fix: 'No Fix'},
        attitude: {roll: 0, pitch: 0, yaw: 0},
        position: {lat: 45.77, lng: 126.67, alt: 0}, // 默认位置
        velocity: {speed: 0},
        trajectory: [], //  <--- 轨迹
        relay_on: false // <--- 继电器状态
    })

    // --- 3. 交互触发器 ---
    const mapTriggers = reactive({
        saveCurrentMap: false,
        clearMap: false,
        redrawMission: false,
        centerMap: false,
    })
    // --- 2. 任务数据 ---
    const mission = reactive({
        plannedWaypoints: [],
        uploadedWaypoints: [],
        defaults: {speed: 2.0, loiter: 0},
        progress: {
            current: 0,
            total: 0
        }
    })
    const sysLogs = reactive([]);

    // --- WebSocket 相关变量 ---
    let socket = null;
    let reconnectTimer = null;
    const WS_URL = 'ws://10.91.63.246:8765';
    // const WS_URL = 'ws://localhost:8765';

    // ==========================================
    // WebSocket 核心逻辑
    // ==========================================

    function connectWebSocket() {
        if (socket && socket.readyState === WebSocket.OPEN) return;

        console.log("正在连接后端服务...");
        socket = new WebSocket(WS_URL);

        socket.onopen = () => {
            console.log("后端连接成功!");
            ElMessage.success('地面站后端已连接');
            if (reconnectTimer) clearInterval(reconnectTimer);
            sendPacket("CMD_CONNECT_VEHICLE", {});
        };
        socket.binaryType = "arraybuffer";
        const decoder = new TextDecoder('utf-8');

        socket.onmessage = (event) => {
            try {
                let jsonString = '';
                if (event.data instanceof ArrayBuffer) {
                    jsonString = decoder.decode(event.data);
                } else {
                    jsonString = event.data;
                }
                const msg = JSON.parse(jsonString);
                handleIncomingMessage(msg);
            } catch (e) {
                console.error("解析消息失败:", e);
                if (event.data instanceof ArrayBuffer) {
                    console.log("Raw binary data length:", event.data.byteLength);
                } else {
                    console.log("Raw text data:", event.data);
                }
            }
        };

        socket.onclose = () => {
            console.warn("后端连接断开，3秒后重连...");
            vehicle.connected = false;
            socket = null;
            if (!reconnectTimer) {
                reconnectTimer = setInterval(connectWebSocket, 3000);
            }
        };

        socket.onerror = (err) => {
            console.error("WebSocket 错误:", err);
        };
    }

    // --- 消息分发处理 ---
    function handleIncomingMessage(msg) {
        const {type, payload} = msg;

        switch (type) {
            case 'DATA_NAV':
                if (payload.position && payload.position.lat) {
                    vehicle.position.lat = payload.position.lat;
                    vehicle.position.lng = payload.position.lon;
                    vehicle.position.alt = payload.position.rel_alt;
                    // 添加到轨迹
                    vehicle.trajectory.push([payload.position.lat, payload.position.lon]);
                }
                if (payload.attitude) {
                    vehicle.attitude = {
                        roll: payload.attitude.roll_deg ?? 0,
                        pitch: payload.attitude.pitch_deg ?? 0,
                        yaw: payload.attitude.yaw_deg ?? 0
                    };
                }
                if (payload.velocity) {
                    vehicle.velocity.speed = payload.velocity.ground_speed_m_s;
                }
                break;

            case 'DATA_STATUS':
                vehicle.connected = payload.is_connected;
                vehicle.armed = payload.is_armed;
                vehicle.mode = payload.flight_mode;
                if (payload.battery) vehicle.battery = payload.battery;
                if (payload.gps) vehicle.gps = {sats: payload.gps.sat_count, fix: payload.gps.fix_type};
                break;
            case 'DATA_LOG':
                addLog(payload.text, payload.level);
                break;
            case 'ACK':
                handleAck(payload);
                break;
            case 'DATA_MISSION_PROGRESS':
                mission.progress.current = payload.current;
                mission.progress.total = payload.total;
                break;
            case 'DATA_RELAY_STATUS': // <--- 处理继电器状态反馈
                vehicle.relay_on = payload.state === 1;
                break;
            default:
            // console.log("未知消息类型:", type);
        }
    }

    function addLog(text, level = 'INFO', ts = null) {
        const timeStr = new Date().toLocaleTimeString();
        sysLogs.unshift({
            id: Date.now() + Math.random(),
            time: timeStr,
            text: text,
            level: level
        });
        if (sysLogs.length > 50) {
            sysLogs.pop();
        }
    }

    function handleAck(payload) {
        const {command_type, success, message} = payload;
        if (success) {
            if (command_type !== 'CMD_MANUAL_CONTROL' && command_type !== 'CMD_SET_RELAY') {
                ElMessage.success(message || '指令执行成功');
            }
            if (command_type === 'CMD_DOWNLOAD_MISSION' && payload.mission_items) {
                processDownloadedMission(payload.mission_items);
            }
        } else {
            ElNotification({
                title: '指令失败',
                message: message,
                type: 'error',
                duration: 5000
            });
        }
    }

    function processDownloadedMission(items) {
        if (!items || items.length === 0) {
            ElMessage.info("飞控未返回有效航点数据");
            return;
        }
        const validPoints = [];
        items.forEach((item) => {
            if (item.latitude == null || isNaN(item.latitude) ||
                item.longitude == null || isNaN(item.longitude)) {
                return;
            }
            let safeSpeed = item.speed_m_s;
            if (safeSpeed === null || safeSpeed === undefined || isNaN(safeSpeed)) {
                safeSpeed = mission.defaults.speed;
            }
            validPoints.push({
                seq: validPoints.length + 1,
                lat: item.latitude,
                lng: item.longitude,
                speed: safeSpeed,
                loiter: item.loiter || 0
            });
        });
        if (validPoints.length === 0) {
            ElMessage.warning("下载的数据中不包含有效坐标");
            return;
        }
        mission.plannedWaypoints = validPoints;
        triggerRedraw();
        ElMessage.success(`已加载 ${validPoints.length} 个航点`);
    }

    function sendPacket(type, payload) {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            if (type !== 'CMD_MANUAL_CONTROL') {
                ElMessage.warning('未连接到后端服务');
            }
            return;
        }
        const packet = {
            type: type,
            payload: payload,
            request_id: Date.now().toString()
        };
        socket.send(JSON.stringify(packet));
    }

    function updatePlannedMission(latlngs) {
        const oldPoints = mission.plannedWaypoints;
        mission.plannedWaypoints = latlngs.map((pt, index) => {
            const oldPt = oldPoints[index];
            const useOld = oldPt && Math.abs(oldPt.lat - pt.lat) < 0.0001 && Math.abs(oldPt.lng - pt.lng) < 0.0001;
            return {
                seq: index + 1,
                lat: pt.lat,
                lng: pt.lng,
                speed: useOld ? oldPt.speed : mission.defaults.speed,
                loiter: useOld ? oldPt.loiter : mission.defaults.loiter
            };
        });
    }

    function triggerRedraw() {
        mapTriggers.redrawMission = true;
        setTimeout(() => {
            mapTriggers.redrawMission = false
        }, 50);
    }

    function triggerMapSave() {
        mapTriggers.saveCurrentMap = true;
        setTimeout(() => {
            mapTriggers.saveCurrentMap = false
        }, 100);
    }

    function triggerMapClear() {
        mapTriggers.clearMap = true;
        mission.plannedWaypoints = [];
        setTimeout(() => {
            mapTriggers.clearMap = false
        }, 100);
    }

    // --- 新增: 清除轨迹 ---
    function clearTrajectory() {
        vehicle.trajectory = [];
        ElMessage.success('轨迹已清除');
    }

    // --- 新增: 继电器控制 ---
    function setRelay(state) {
        sendPacket('CMD_SET_RELAY', {state: state ? 1 : 0});
    }

    return {
        vehicle,
        mission,
        mapTriggers,
        connectWebSocket,
        sendPacket,
        updatePlannedMission,
        triggerMapSave,
        triggerMapClear,
        triggerRedraw,
        clearTrajectory,
        setRelay, // <--- 导出
        sysLogs
    }
})