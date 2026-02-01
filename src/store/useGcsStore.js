import {defineStore} from 'pinia'
import {reactive, ref} from 'vue'
import {ElMessage, ElNotification, ElMessageBox} from 'element-plus'

export const useGcsStore = defineStore('gcs', () => {
    // --- 1. 车辆状态 ---
    const vehicle = reactive({
        connected: false,
        armed: false,
        mode: 'UNKNOWN',
        // 修改：适配新的电池数据结构
        battery: {
            voltage_v: 0,
            remaining_percent: 0,
            current_a: 0.0,
            temperature: 0.0,
            alarms: []
        },
        gps: {sats: 0, fix: 'No Fix'},
        attitude: {roll: 0, pitch: 0, yaw: 0},
        position: {lat: 45.77, lng: 126.67, alt: 0}, // 默认位置
        home: null, // 新增：HOME点坐标
        velocity: {speed: 0},
        trajectory: [], //  <--- 轨迹
        relay_on: false // <--- 继电器状态
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
    
    // --- 3. 规划器状态 ---
    const plannerMode = ref('manual'); // 'manual' | 'area'
    const areaPoints = ref([]); // 区域规划的四个角点

    // --- 4. 交互触发器 ---
    const mapTriggers = reactive({
        saveCurrentMap: false,
        clearMap: false,
        redrawMission: false,
        centerMap: false,
        gotoTargetCandidate: null, // 新增：指点目标候选
    })

    const sysLogs = reactive([]);

    // --- WebSocket 相关变量 ---
    let socket = null;
    let reconnectTimer = null;
    const isWsConnected = ref(false);
    const wsUrl = ref(localStorage.getItem('wsUrl') || 'ws://10.91.63.246:8765');


    // ==========================================
    // WebSocket 核心逻辑
    // ==========================================

    function connectWebSocket() {
        if (socket && socket.readyState === WebSocket.OPEN) return;

        console.log(`正在连接后端服务: ${wsUrl.value}`);
        socket = new WebSocket(wsUrl.value);

        socket.onopen = () => {
            console.log("后端连接成功!");
            isWsConnected.value = true;
            ElNotification.success({ title: '系统消息', message: '地面站后端已连接' });
            if (reconnectTimer) {
                clearInterval(reconnectTimer);
                reconnectTimer = null;
            }
            sendPacket("CMD_CONNECT_VEHICLE", {});
            // 移除：连接后自动下载任务 (改为在飞控连接后触发)
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
            isWsConnected.value = false;
            vehicle.connected = false;
            socket = null;
            if (!reconnectTimer) {
                reconnectTimer = setInterval(connectWebSocket, 3000);
            }
        };

        socket.onerror = (err) => {
            console.error("WebSocket 错误:", err);
            isWsConnected.value = false;
            vehicle.connected = false;
        };
    }
    
    function disconnectWebSocket() {
        if (reconnectTimer) {
            clearInterval(reconnectTimer);
            reconnectTimer = null;
        }
        if (socket) {
            socket.close();
            socket = null;
        }
        isWsConnected.value = false;
        vehicle.connected = false;
    }

    function changeWsUrl(newUrl) {
        if (newUrl === wsUrl.value) {
            ElNotification.info({ title: '提示', message: "新地址与当前地址相同，无需更改。" });
            return;
        }

        const doChange = () => {
            wsUrl.value = newUrl;
            localStorage.setItem('wsUrl', newUrl);
            ElNotification.success({ title: '系统消息', message: "连接地址已更新，正在重新连接..." });
            disconnectWebSocket();
            setTimeout(connectWebSocket, 500); // 稍作延迟以确保旧连接完全关闭
        };

        if (isWsConnected.value) {
            ElMessageBox.confirm(
                '当前已连接到后端服务，更改地址将断开现有连接。是否继续?',
                '警告',
                {
                    confirmButtonText: '强制切换',
                    cancelButtonText: '取消',
                    type: 'warning',
                    customClass: 'hud-message-box'
                }
            ).then(() => {
                doChange();
            }).catch(() => {
                ElNotification.info({ title: '提示', message: "已取消更改。" });
            });
        } else {
            doChange();
        }
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
                // 修改：直接赋值新的电池对象
                if (payload.battery) {
                    vehicle.battery = payload.battery;
                }
                if (payload.gps) vehicle.gps = {sats: payload.gps.sat_count, fix: payload.gps.fix_type};
                if (payload.home && payload.home.lat && payload.home.lon) {
                    vehicle.home = payload.home;
                }
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
                ElNotification.success({ title: '指令成功', message: message || '指令执行成功' });
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
        if (!items) { // 允许空任务
            mission.plannedWaypoints = [];
            mission.progress.total = 0;
            mission.progress.current = 0;
            ElNotification.info({ title: '任务信息', message: "飞控上无任务" });
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

        mission.plannedWaypoints = validPoints;
        mission.progress.total = validPoints.length;
        mission.progress.current = 0; // 重置当前航点
        triggerRedraw();
        if (validPoints.length > 0) {
            ElNotification.success({ title: '任务加载', message: `已从飞控加载 ${validPoints.length} 个航点` });
        } else {
            ElNotification.info({ title: '任务信息', message: "飞控上无有效航点" });
        }
    }

    function sendPacket(type, payload) {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            if (type !== 'CMD_MANUAL_CONTROL') {
                ElNotification.warning({ title: '连接警告', message: '未连接到后端服务' });
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
        ElNotification.success({ title: '操作成功', message: '轨迹已清除' });
    }

    // --- 新增: 继电器控制 ---
    function setRelay(state) {
        sendPacket('CMD_SET_RELAY', {state: state ? 1 : 0});
    }
    
    // --- 区域规划相关 ---
    function setPlannerMode(mode) {
        plannerMode.value = mode;
        if (mode === 'manual') {
            clearAreaPoints();
        }
    }

    function addAreaPoint(latlng) {
        if (areaPoints.value.length < 4) {
            areaPoints.value.push(latlng);
            triggerRedraw(); // 触发地图重绘以显示区域
        }
    }

    function clearAreaPoints() {
        areaPoints.value = [];
        triggerRedraw();
    }
    
    // --- 新增: 设置家点 ---
    function setHome(lat, lon, alt = 0) {
        sendPacket('CMD_SET_HOME', {
            lat: lat,
            lon: lon,
            alt: alt
        });
    }

    // --- 新增: 指点模式 ---
    function setGotoTargetCandidate(latlng) {
        mapTriggers.gotoTargetCandidate = latlng;
    }


    return {
        vehicle,
        mission,
        mapTriggers,
        sysLogs,
        plannerMode,
        areaPoints,
        isWsConnected,
        wsUrl,

        connectWebSocket,
        changeWsUrl,
        sendPacket,
        updatePlannedMission,
        triggerMapSave,
        triggerMapClear,
        triggerRedraw,
        clearTrajectory,
        setRelay,
        
        setPlannerMode,
        addAreaPoint,
        clearAreaPoints,
        setHome,
        setGotoTargetCandidate
    }
})