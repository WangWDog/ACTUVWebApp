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
        velocity: {speed: 0}
    })

    // --- 3. 交互触发器 ---
    const mapTriggers = reactive({
        saveCurrentMap: false,
        clearMap: false,
        redrawMission: false
    })
    // --- 2. 任务数据 ---
    const mission = reactive({
        plannedWaypoints: [],
        uploadedWaypoints: [],
        defaults: {speed: 2.0, loiter: 0},
        // [新增] 实时进度
        progress: {
            current: 0,
            total: 0
        }
    })
    const sysLogs = reactive([]);

    // --- WebSocket 相关变量 ---
    let socket = null;
    let reconnectTimer = null;
    const WS_URL = 'ws://localhost:8765';

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

            // 连接后立刻请求一次飞控连接 (可选，取决于后端逻辑)
            sendPacket("CMD_CONNECT_VEHICLE", {});
        };

        socket.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                handleIncomingMessage(msg);
            } catch (e) {
                console.log(event.data)
                console.error("解析消息失败:", e);
            }
        };

        socket.onclose = () => {
            console.warn("后端连接断开，3秒后重连...");
            vehicle.connected = false; // 地面站断了，飞控自然也算断了
            socket = null;
            // 简单的重连机制
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
            // 1. 高频导航数据 (10Hz)
            case 'DATA_NAV':
                // 更新位置 (如果 lat 是 0 或 null 则不更新，防止地图飞到非洲)
                if (payload.position && payload.position.lat) {
                    vehicle.position.lat = payload.position.lat;
                    vehicle.position.lng = payload.position.lon;
                    vehicle.position.alt = payload.position.rel_alt;
                }
                if (payload.attitude) {
                    vehicle.attitude = {
                        roll: payload.attitude.roll_deg ?? payload.attitude.roll ?? 0,
                        pitch: payload.attitude.pitch_deg ?? payload.attitude.pitch ?? 0,
                        yaw: payload.attitude.yaw_deg ?? payload.attitude.yaw ?? 0
                    };
                }
                if (payload.velocity) {
                    vehicle.velocity.speed = payload.velocity.ground_speed_m_s;
                }
                break;

            // 2. 低频状态数据 (1Hz)
            case 'DATA_STATUS':
                vehicle.connected = payload.is_connected;
                vehicle.armed = payload.is_armed;
                vehicle.mode = payload.flight_mode;
                if (payload.battery) vehicle.battery = payload.battery;
                if (payload.gps) vehicle.gps = {sats: payload.gps.sat_count, fix: payload.gps.fix_type};
                break;
            case 'DATA_LOG':
                addLog(payload.text, payload.level, timestamp);
                break;
            // 3. 指令回执 (ACK)
            case 'ACK':
                handleAck(payload);
                break;
            case 'DATA_MISSION_PROGRESS':
                mission.progress.current = payload.current;
                mission.progress.total = payload.total;
                break;

            default:
            // console.log("未知消息类型:", type);
        }
    }

    function addLog(text, level = 'INFO', ts = null) {
        const timeStr = new Date().toLocaleTimeString();

        // 插入头部
        sysLogs.unshift({
            id: Date.now() + Math.random(), // 唯一key
            time: timeStr,
            text: text,
            level: level // 'INFO', 'WARNING', 'ERROR'
        });

        // 限制最大条数 (只保留最新的 50 条)
        if (sysLogs.length > 50) {
            sysLogs.pop();
        }
    }

    // --- ACK 处理逻辑 ---
    function handleAck(payload) {
        const {command_type, success, message} = payload;

        if (success) {
            // 成功提示 (除了高频的手动控制外)
            if (command_type !== 'CMD_MANUAL_CONTROL') {
                ElMessage.success(message || '指令执行成功');
            }

            // 特殊处理：如果是下载任务成功，需要更新前端数据并重绘
            if (command_type === 'CMD_DOWNLOAD_MISSION' && payload.mission_items) {
                processDownloadedMission(payload.mission_items);
            }
        } else {
            // 失败报错
            ElNotification({
                title: '指令失败',
                message: message,
                type: 'error',
                duration: 5000
            });
        }
    }

    // 处理下载回来的任务
// 处理下载回来的任务
// 处理下载回来的任务
    function processDownloadedMission(items) {
        // 1. 基础判空
        if (!items || items.length === 0) {
            ElMessage.info("飞控未返回有效航点数据");
            return;
        }

        // 2. 映射并再次过滤 (双重保险)
        const validPoints = [];

        items.forEach((item, index) => {
            // 检查坐标有效性
            if (item.latitude == null || isNaN(item.latitude) ||
                item.longitude == null || isNaN(item.longitude)) {
                return; // 跳过坏点
            }

            let safeSpeed = item.speed_m_s;
            if (safeSpeed === null || safeSpeed === undefined || isNaN(safeSpeed)) {
                safeSpeed = mission.defaults.speed;
            }

            validPoints.push({
                seq: validPoints.length + 1, // 重新生成连续序号
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

        // 3. 更新数据并重绘
        mission.plannedWaypoints = validPoints;
        triggerRedraw();
        ElMessage.success(`已加载 ${validPoints.length} 个航点`);
    }

    // ==========================================
    // 发送指令通用函数
    // ==========================================
    function sendPacket(type, payload) {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            // 如果是手动控制这种高频指令，没连接就不弹窗了，太吵
            if (type !== 'CMD_MANUAL_CONTROL') {
                ElMessage.warning('未连接到后端服务');
            }
            return;
        }

        const packet = {
            type: type,
            payload: payload,
            request_id: Date.now().toString() // 简单生成个 ID
        };
        socket.send(JSON.stringify(packet));
    }

    // ==========================================
    // 前端交互 Actions (保持不变)
    // ==========================================

    function updatePlannedMission(latlngs) {
        // 逻辑保持之前的 diff 逻辑不变
        const oldPoints = mission.plannedWaypoints;
        mission.plannedWaypoints = latlngs.map((pt, index) => {
            const oldPt = oldPoints[index];
            // 简易判断是否为同一个点
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

    return {
        vehicle,
        mission,
        mapTriggers,
        connectWebSocket, // 导出连接函数
        sendPacket,       // 导出发送函数
        updatePlannedMission,
        triggerMapSave,
        triggerMapClear,
        triggerRedraw,
        sysLogs
    }
})