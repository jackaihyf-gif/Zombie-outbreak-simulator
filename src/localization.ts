import type { PlayerRole, PlayerWeapon } from './types';

export type GameLanguage = 'zh' | 'en';
export const PLAYER_ROLE_NAMES: Record<PlayerRole, [string, string]> = {
  civilian: ['Civilian', '逃亡平民'],
  police: ['Police Officer', '巡警'],
  swat: ['SWAT Operator', '特种部队']
};
export const WEAPON_NAMES: Record<PlayerWeapon, [string, string]> = {
  pistol: ['Pistol', '手枪'],
  shotgun: ['Shotgun', '霰弹枪'],
  carbine: ['Carbine', '卡宾枪']
};

const existingLabels: Record<string, string | string[]> = {
  ".brand-logo span:last-child": "疫情爆发",
  ".stat-lbl": [
    "健康",
    "感染",
    "警员",
    "治愈",
    "避难",
    "撤离",
    "死亡"
  ],
  "#btn-find-infected": "🔍 寻找感染者",
  "#btn-auto-cam": "🎬 自动镜头",
  "#btn-open-scenarios": "⚙ 场景",
  "[data-tab=radar]": "📡 雷达",
  "[data-tab=trend]": "📈 趋势",
  ".tool-btn > span:first-child": [
    "🔍 查看",
    "🚓 巡逻队",
    "🛡️ 特种部队",
    "🚑 医疗队",
    "📢 诱饵",
    "💣 打击",
    "🚧 路障",
    "🎯 防守",
    "🚩 撤离点",
    "📡 优先区域"
  ],
  "#btn-follow-agent": "跟随",
  "#fps-hud .fps-bar-label span:first-child": [
    "生命",
    "体力"
  ],
  "#btn-exit-fps": "退出 (F)",
  "#btn-fps-commander": "指挥官视角",
  "#scenario-modal .modal-title span:last-child": "疫情爆发 · 地图与场景",
  "#scenario-modal .section-lbl": [
    "1. 选择地图",
    "2. 选择爆发模式"
  ],
  ".map-card .tag": [
    "三道防线 · 456 米城市走廊",
    "7×7 路网 · 49 个街区",
    "两道桥头堡防线 · 跨河瓶颈",
    "5×5 高密度街区",
    "封闭地下气密隔离区 · APC 隧道突围"
  ],
  ".map-card h3": [
    "🧱 城墙与特快列车",
    "🏙️ 超级都市",
    "🌉 跨河双桥",
    "🏟️ 霓虹市中心",
    "☣️ BSL-4 地下绝密实验室"
  ],
  ".map-card p": [
    "穿过高速公路事故区、市中心运河、砖墙小巷与三道防线，抵达南部 KTX 车站。",
    "摩天楼、体育场广场和工业区组成的大城市，设有两处撤离终点。",
    "河流隔开市中心与南部安全区，两岸建有桥头堡城墙与防爆闸门，支持尸潮破城模式与油罐车陷阱。",
    "高楼间的狭窄街区，恐慌会沿十字路口迅速扩散。",
    "纯地下封闭式生化综合体：从破裂的 0 号收容舱突围，穿越 3 组气密消毒舱、玻璃观察窄廊、可反锁实验室、挑高反应堆天桥与停电危化区，在地下车库坚守 40 秒乘 APC-01 冲出山体隧道。"
  ],
  ".scenario-card .tag": [
    "多道防线 · 尸堆与列车",
    "经典爆发",
    "多区同时爆发",
    "三波尸潮",
    "通信中断",
    "2.5 秒潜伏",
    "纯沙盒"
  ],
  ".scenario-card h3": [
    "🚄 WWZ × 釜山狂潮",
    "🧬 零号病人",
    "☣️ 多点爆发",
    "🌊 赤潮围城",
    "📡 延迟响应",
    "⚡ 快速毒株",
    "👁️ 无干预"
  ],
  ".scenario-card p": [
    "尸群在前两道防线外堆叠翻墙，南部特快列车循环进站。",
    "一名潜伏感染者引发爆发，警员和医护照常巡逻。",
    "五个街区同时爆发，警力被迫分散。",
    "感染者和巨型丧尸从北部涌入，后续尸潮接连出现。",
    "两名感染者引发爆发，报警系统中断 35 秒。",
    "潜伏期仅 2.5 秒，丧尸更快，跑者和巨型变种更常见。",
    "指挥工具锁定，观察城市防线如何应对。"
  ],
  "#scenario-modal .config-field label": [
    "随机种子",
    "人口数量",
    "潜伏期"
  ],
  "#select-population option": [
    "300 人（标准）",
    "600 人（高峰）",
    "1200 人（大都会）",
    "2200 人（末日尸潮）"
  ],
  "#select-incubation option": [
    "3 秒（快速）",
    "7 秒（普通）",
    "12 秒（隐匿）"
  ],
  "#btn-close-modal": "关闭",
  "#btn-launch-scenario": "▶ 启动模拟"
};

export function collectLocalizedLabels(): Array<{ element: HTMLElement; english: string; chinese: string }> {
  const labels: Array<{ element: HTMLElement; english: string; chinese: string }> = [];
  for (const element of document.querySelectorAll<HTMLElement>('[data-zh]')) {
    labels.push({ element, english: element.textContent!, chinese: element.dataset.zh! });
  }
  for (const [selector, chinese] of Object.entries(existingLabels)) {
    document.querySelectorAll<HTMLElement>(selector).forEach((element, index) => {
      const translation = Array.isArray(chinese) ? chinese[index] : chinese;
      if (translation) labels.push({ element, english: element.textContent!, chinese: translation });
    });
  }
  return labels;
}

const terms: Record<string, string> = {
  'CITY NORMAL': '城市正常', 'LOCAL INCIDENT': '局部事件', 'ACTIVE OUTBREAK': '感染爆发',
  'CONTAINED': '疫情受控', 'CRITICAL COLLAPSE': '城市濒临沦陷',
  HOLDING: '守住', WITHDRAWN: '已撤防', BREACHED: '失守', CONTESTED: '交战中', 'UNDER SIEGE': '遭围攻',
  SEALED: '已气密锁死', OPEN: '已开启',
  'South Express Station': '南部特快车站', 'KTX Platform 1': 'KTX 一号站台',
  'Evac Zone': '撤离区', 'Evacuation Zone': '撤离区', 'Antiviral Medkit': '抗病毒急救包',
  'Energy Drink': '能量饮料', 'Emergency Pack': '应急包', 'Store Counter': '商店柜台',
  'KTX East Gate': 'KTX 东侧登车闸', 'KTX West Gate': 'KTX 西侧勤务闸',
  'KTX Mezzanine Gate': 'KTX 夹层咽喉闸', 'KTX Mezzanine Holding': '夹层候车待命',
  'KTX Service Partition': '站台勤务隔门', 'KTX Service Platform': '西侧勤务段',
  'KTX Intake': '桥下收容区入口',
  'KTX East Stair': '东侧登车梯', 'KTX West Stair': '西侧勤务梯',
  'KTX East Landing': '东梯半层平台', 'KTX West Landing': '西梯半层平台',
  'KTX Holding Area': '站前等候区', 'KTX Platform': '高架站台', 'Holding KTX platform': '固守高架站台',
  'KTX Ground Passage': '车站地面通道',
  'Covering KTX stair landing': '在车站半层平台掩护撤退',
  'Holding KTX waiting deck': '驻守高架候车平台',
  'Hunter team searching': '机动清剿队正在搜索',
  'Hunter team pursuing infected': '机动清剿队正在追击感染者',
  'Rallying behind Line 3': '在第三道防线后方集结',
  'Falling back from KTX waiting deck': '从高架候车平台撤往登车口',
  'Covering KTX service partition': '在西侧勤务隔墙掩护撤退',
  'Covering civilian evacuation': '掩护平民撤离',
  'Aboard KTX-101': '已进入 KTX-101 车厢',
  'Sealing KTX carriage': '封锁车厢隔门',
  'Covering KTX carriage': '在车厢内开火掩护',
  'Fleeing through KTX carriages': '向安全车厢撤离',
  'Moving through KTX': '沿列车过道移动',
  'KTX Forecourt': 'KTX 站前广场', 'KTX Main Stair': '站厅入口楼梯',
  'KTX Concourse': '候车大厅', 'KTX Ticket Gates': '检票通道',
  'KTX Switchback Ramp': '折返坡道', 'KTX Emergency Stair': '应急楼梯',
  'KTX Boarding Queue': '站台缓冲区', 'Wait on KTX Platform': '在站台等车',
  'Wait on KTX Terrace': '在露台区等车', 'KTX Canopy Holding': '在站前雨棚候车',
  'KTX Boarding Door': 'KTX 登车口',
  'KTX Car 3 Boarding Door': 'KTX 三号车厢登车口',
  'Car 1 Safe Cabin Console [E]': '一号车厢驾驶台 [E]',
  'Line 1 • North Bridgehead Wall': '第1道防线 · 北桥头城墙',
  'Line 2 • South Bridgehead Wall': '第2道防线 · 南桥头城墙',
  'Midtown Arcade Mart': '市中心街机便利店',
  'Southside 24H Pharmacy': '南区24小时药房',
  'Advancing on the South Safe Zone': '向南部安全区推进',
  'Clinic Bed': '诊所病床', Bench: '长椅', 'KTX Car 1 — Engineer Cabin Console': 'KTX 一号车厢驾驶台',
  'Zone 1 • Sector 0 Containment Vault': '第1区 · 0号绝密收容舱室',
  'Zone 2 • Quarantine & Bio-Lock 1': '第2区 · 检疫缓冲区与1号气密闸',
  'Zone 2 • Quarantine & Airlock Alpha': '第2区 · 检疫区与 Alpha 气密隔离舱',
  'Zone 3 • Cryo Vault & Biobank': '第3区 · 深冷样本库区',
  'Zone 4 • Genetics & Autopsy Wing': '第4区 · 基因测序与病理解剖翼楼',
  'Zone 5 • Reactor Core & Bio-Lock 2': '第5区 · 反应堆大厅与2号气密闸',
  'Zone 5 • Vaulted Reactor Core': '第5区 · 挑高反应堆中庭',
  'Zone 6 • Security Command & Armory': '第6区 · 安保指挥中心与军械库',
  'Zone 6 • Airlock Beta & Security Command': '第6区 · Beta 气密闸与安保区',
  'Zone 7 • Generator & Hazmat Bay': '第7区 · 备用发电机与断电危化区',
  'Zone 8 • Extraction Garage & Tunnel': '第8区 · 地下车库与隧道撤离口',
  'Zone 8 • Airlock Gamma & Extraction Garage': '第8区 · Gamma 气密闸与撤离车库',
  'Airlock Alpha': 'Alpha 主气密闸',
  'Airlock Beta': 'Beta 主气密闸',
  'Airlock Gamma': 'Gamma 主气密闸',
  'Airlock α': 'Alpha 气密闸',
  'Airlock β': 'Beta 气密闸',
  'Airlock γ': 'Gamma 气密闸',
  'Bio-Lock 1 • Quarantine Bulkhead': '第1道密封墙 · 检疫防爆闸',
  'Bio-Lock 2 • Reactor Containment': '第2道密封墙 · 反应堆防爆闸',
  'Bulkhead 3 • Extraction Garage': '第3道密封墙 · 撤离车库防爆闸',
  'West Reactor Catwalk': '反应堆西侧高架天桥',
  'East Reactor Catwalk': '反应堆东侧高架天桥',
  'Cryo Biobank West': '西侧低温生物样本库',
  'Cryo Specimen Lab East': '东侧深冷实验间',
  'Virology & Autopsy Suite': '病毒学与病理解剖室',
  'Genetics Core Lab': '基因测序核心实验室',
  'BSL-4 Cleanroom Wing': 'BSL-4 正压洁净室',
  'Security Command Center': '安保监控指挥室',
  'Tactical Armory & Infirmary': '战术军械与急救医疗室',
  'APC-01 Armored Extraction': 'APC-01 装甲撤离车',
  'APC-01 Extraction Garage': 'APC-01 地下撤离车库',
  'Start APC-01 Extraction [E]': '前往车库启动 APC-01 [E]',
  'Hold Garage for APC-01': '在车库坚守等待 APC-01 预热',
  'Board APC-01 Rear Ramp [E]': '从尾门登上 APC-01 [E]',
  'Subject-00 "TYRANT"': '零号实验体 · 暴君',
  'Cryo Purge Valve': '液氮泄压阀',
  'Security Turret Terminal': '自动机枪塔控制台',
  'Backup Power Generator': '备用应急发电机',
  'Lab Corridor': '实验室主走廊',
  'Triggering BIO-ALARM': '正在触发实验室生物警报',
  'Holding at Extraction Garage (APC-01)': '在撤离车库集结待命（APC-01）',
  'Boarding APC-01': '正在登上 APC-01 装甲车',
  'Storming the Extraction Garage': '正突入第 8 区撤离车库'
};

export function translateWorldLabel(label: string): string {
  return terms[label] ?? label
    .replace(/Line (\d+) (West|East) Gate/g, (_, line, side) => `第${line}道防线${side === 'West' ? '西' : '东'}闸门`)
    .replace(/waiting away from (.+)$/i, (_, rest: string) => `在${translateWorldLabel(rest)}外围分散等候`)
    .replace(/^Waiting outside (.+)$/, (_, room: string) => `在${translateWorldLabel(room)}外等待`)
    .replace(/^Assaulting (.+)$/, (_, target: string) => `正攻击${translateWorldLabel(target)}`)
    .replace(/^Surging through (.+)$/, (_, target: string) => `正涌入${translateWorldLabel(target)}`)
    .replace(/^Approaching (.+)$/, '前往$1')
    .replace(/^Evacuating through (.+)$/, '经$1撤离')
    .replace(/^Barricaded inside (.+)$/, (_, room: string) => `在${translateWorldLabel(room)}内反锁坚守`)
    .replace(/^Crossing (.+)$/, '正在通过$1')
    .replace(/^Clearing the inside of (.+)$/, '正在离开$1内侧通道')
    .replace(/^Line (\d+)$/, '第$1道防线')
    .replace(/Sector (\d+)/g, '第$1区')
    .replace(/Car (\d+)/g, '$1号车厢')
    .replace(/ \(Closing\)/g, '（关闭中）')
    .replace(/ \(Sealed — \[E\] Open\)/g, '（已关闭，E 开门）')
    .replace(/Glass Door/g, '玻璃门')
    .replace(/North Highway Pileup/g, '北部高速事故区')
    .replace(/West Boulevard/g, '西大道')
    .replace(/Midtown Canal/g, '市中心运河')
    .replace(/Midtown Parking & Shops/g, '市中心商铺与停车区')
    .replace(/Commercial Canyon/g, '商业街')
    .replace(/Police Precinct/g, '警察分局')
    .replace(/Inner Residential/g, '内城住宅区');
}

const gameplayAlerts: Record<string, string> = {
  'KTX QUARANTINE: Eliminate all infected aboard.': '列车已抵达隔离终点 · 消灭全部车上感染者后才能撤离',
  'KTX EVACUATION FAILED: Infected remain aboard.': '列车撤离失败 · 车内仍有感染者',
  'Hunter team deployed': '机动清剿队已部署',
  'EVACUATION: Sector 2, proceed through Line 3 to KTX.': '第一道防线发现感染者 · 第二区居民经第三道防线前往 KTX 车站登车',
  'EVACUATION: Sector 3 and rally groups, proceed to KTX.': '第二道防线发现感染者 · 第三区居民与已集结人群立即前往车站',
  'BIO-CONTAINMENT ALERT: Zones 2–4 personnel evacuate south through Bio-Lock 2!': '☣ 生化泄露警报：2–4 区科研人员立即经 2 号气密闸向南撤离！',
  'BIO-CONTAINMENT ALERT: Zones 2–4 personnel evacuate south through Airlock Beta!': '☣ 生化泄露警报：2–4 区科研人员立即经 Beta 气密隔离舱向南撤离！',
  'FACILITY-WIDE EVACUATION: All personnel report to Zone 8 Extraction Garage (APC-01)!': '🚨 全设施紧急撤离：所有幸存人员立即前往第 8 区地下车库（APC-01）集结！',
  'BREACH: KTX East Gate': 'KTX 东侧登车闸已失守',
  'BREACH: KTX West Gate': 'KTX 西侧勤务闸已失守',
  'BREACH: KTX Mezzanine Gate': 'KTX 夹层咽喉闸已失守',
  'BREACH: KTX Service Partition': '站台勤务隔门已失守',
  'KTX-101 DEPARTED': '🚄 KTX-101 已发车',
  'AMMUNITION RESTOCKED': '弹药已补满',
  'NO REINFORCEMENTS BEYOND THE FALLEN LINE': '该位置已失守，无法增援',
  'WWZ × BUSAN SURGE: Sector 1 Outbreak! Protect Defense Line 1!': '釜山狂潮 · 第 1 区爆发，守住第一道防线！',
  '⚠ OVERPASS DROP: Infected tumbling from the elevated highway!': '⚠ 感染者正从高架公路跌落！',
  '⚠ INFECTED (18s): Grab a green Antiviral Kit or find a Medic!': '⚠ 已感染 · 18 秒内找到绿色抗病毒急救包或医疗人员！',
  '🍾 NOISE DECOY THROWN — Luring nearby infected!': '🍾 已投掷诱饵，正在引开附近的感染者！',
  '🚨 CAR ALARM TRIGGERED — Distracting nearby horde!': '🚨 已触发汽车警报，正在引开附近的尸群！',
  '🚄 KTX-101 APPROACHING PLATFORM — 5s TO BOARDING!': '🚄 KTX-101 即将进站 · 5 秒后可以登车！',
  'KTX-101 FULL: YOU ARE ON BOARD': '🚄 KTX-101 满载发车，你已登车！',
  'KTX-101 FULL: DEPARTING NOW': '🚄 KTX-101 已满载，立即发车！',
  'KTX-101 EMERGENCY DEPARTURE': '🚄 KTX-101 紧急发车！',
  'KTX EMERGENCY: Infected boarded. Departing immediately.': '🚨 感染者已进入车厢 · KTX 立即发车！',
  'KTX EMERGENCY: Infected boarded. You missed the train.': '🚨 感染者已进入车厢 · 列车已紧急发车，你未能登车。',
  '🚄 KTX-101 DEPARTING FOR BUSAN — YOU MADE IT ON BOARD!': '🚄 KTX-101 向釜山发车 · 你已成功登车！',
  '⚠ MISSED KTX-101! Hold out in Central Station until next train!': '⚠ 错过 KTX-101 · 在中央车站坚持到下一班车！',
  '⚡ ADRENALINE SURGE — Critical HP! 2.8s sprint burst!': '⚡ 肾上腺素爆发 · 生命垂危，获得 2.8 秒极限冲刺！',
  '🚄 EMERGENCY EXPRESS DISPATCHED — Train arriving in 7.5s!': '🚄 紧急特快已调度 · 列车 7.5 秒后进站！',
  '⚡ ENERGY DRINK: 8s Unlimited Sprint Surge!': '⚡ 能量饮料 · 8 秒无限体力爆发！',
  '💉 ANTIVIRAL MEDKIT: +65 HP & Infection Cured!': '💉 抗病毒急救包 · 恢复 65 生命并清除感染！',
  '🎒 EMERGENCY PACK: +40 HP • +60 Stamina • Decoy Refreshed!': '🎒 应急包 · +40 生命 / +60 体力 / 诱饵就绪！',
  '⚠ SECTOR 0 CONTAINMENT BREACH: Specimen Pods shattering!': '⚠ 0 号绝密收容舱破裂 · 实验样本正全数失控！',
  '🚨 APC-01 ENGINE IGNITION: Hold Garage 40s while Escape Tunnel unlocks!': '🚨 APC-01 引擎已点火 · 坚守车库 40 秒等待隧道防爆门开启！',
  '⚠ 20s UNTIL TUNNEL UNLOCK: Second surge breaching Freight Bay!': '⚠ 距隧道开启还有 20 秒 · 第二波尸潮正突破货运区！',
  '✅ TUNNEL OPEN & APC-01 READY: Board the rear ramp [E]!': '✅ 逃生隧道已开启 · 立即从尾门登上 APC-01 [E]！',
  '🚐 ALL ABOARD APC-01! Punching through the Escape Tunnel!': '🚐 全员登车完毕 · APC-01 正高速冲破撤离隧道！',
  '☠ SUBJECT-00 "TYRANT" BREACHED CONTAINMENT POD 01!': '☠ 零号实验体“暴君”撞破 01 号培养舱逃逸！',
  '⚠ SUBJECT-00 TYRANT ENRAGED — Phase 2 Sprint & Charge Unlocked!': '⚠ 暴君进入二阶段狂暴 · 解锁冲刺与突进！',
  '❄️ CRYO PURGE ACTIVE: Zone 3/4 corridors chilled — Infected slowed!': '❄️ 液氮泄压启动 · 3/4 区通道降温，感染者大幅减速！',
  '🔫 SENTRY TURRETS ONLINE (25s): Automated Overwatch covering Zone 6!': '🔫 自动机枪塔已上线（25 秒）· 正在封锁第 6 区走廊！',
  '⚡ BACKUP POWER RESTORED: Zone 7 illuminated • APC-01 Warmup reduced to 25s!': '⚡ 备用供电已恢复 · 危化区照明开启，APC-01 预热缩短至 25 秒！'
};

export function translateGameplayAlert(alert: string): string {
  const apcEscaped = alert.match(/^🚐 ESCAPE SUCCESSFUL: APC-01 cleared the BSL-4 tunnel with (\d+) survivors!$/);
  if (apcEscaped) return `🚐 突围成功 · APC-01 携 ${apcEscaped[1]} 名幸存者冲出 BSL-4 地下隧道！`;
  const climbers = alert.match(/^INFECTED ON LINE (\d+) WALL: Hold the gates!$/);
  if (climbers) return `感染者爬上第 ${climbers[1]} 道城墙 · 继续守住闸门！`;
  const arrival = alert.match(/^KTX ARRIVED: (\d+) safely evacuated\.$/);
  if (arrival) return `列车已安全抵达 · 本班成功撤离 ${arrival[1]} 人`;
  const killReward = alert.match(/^KILL REWARD: (\d+) rounds earned$/);
  if (killReward) return `击杀奖励 · 获得 ${killReward[1]} 发弹药`;
  const autoQuality = alert.match(/^⚙ AUTO QUALITY: Stepped down to (.+) for smoother FPS$/);
  if (autoQuality) return `⚙ 自动画质 · 已调至 ${autoQuality[1]} 以保障流畅帧率`;
  const crimson = alert.match(/^CRIMSON TIDE WAVE (\d+): 35 Infected & Alpha Brutes Incoming!$/);
  if (crimson) return `赤潮第 ${crimson[1]} 波 · 35 名感染者与巨型丧尸正从北部涌来！`;
  const breachedWall = alert.match(/^⚠ (.+) BREACHED! FALL BACK!$/i);
  if (breachedWall) {
    const defenseNum = breachedWall[1].match(/DEFENSE LINE (\d+)/i);
    return defenseNum
      ? `⚠ 第 ${defenseNum[1]} 道防线已失守 · 立即后撤！`
      : `⚠ ${translateWorldLabel(breachedWall[1])}已失守 · 立即后撤！`;
  }
  const total = alert.match(/^(.*) · Evacuated this round: (\d+)$/);
  if (total) return `${translateGameplayAlert(total[1])} · 本局已成功撤离 ${total[2]} 人`;
  const departure = alert.match(/^TRAIN DEPARTED: KTX-101 carried (\d+)\/(\d+) passengers\.$/);
  if (departure) return `KTX-101 已发车 · 本班载客 ${departure[1]}/${departure[2]} 人`;
  const fallback = alert.match(/^Line (\d+) breached · (Falling back to .+)$/);
  if (fallback) return `第 ${fallback[1]} 道防线失守 · ${translateCommanderOrder(fallback[2])}`;
  return gameplayAlerts[alert] ?? alert.replace(
    /^KTX-101 DOCKED \((\d+)s\): BOARD CAR (\d+)$/,
    (_, seconds, car) => `🚄 KTX-101 已进站 · ${seconds} 秒内从 ${car} 号车厢登车`
  ).replace(
    /^SIEGE WAVE (\d+)\/(\d+): (\d+) infected advancing on (?:Line (\d+)|KTX Terminal|South Safe Zone|Extraction Garage|Airlock Alpha|Airlock Beta|Airlock Gamma)!$/,
    (_, wave, total, size, line) => `尸潮 ${wave}/${total} · ${size} 名感染者正在逼近${line ? `第 ${line} 道防线` : alert.includes('Airlock Alpha') ? 'Alpha 气密闸' : alert.includes('Airlock Beta') ? 'Beta 气密闸' : alert.includes('Airlock Gamma') ? 'Gamma 气密闸' : alert.includes('South Safe Zone') ? '南部安全区' : alert.includes('Extraction Garage') ? '撤离车库' : 'KTX 车站'}！`
  ).replace(
    /^LINE (\d+) (WEST|EAST) GATE (OPENING|CLOSING)!$/,
    (_, line, side, action) => `第${line}道防线${side === 'WEST' ? '西' : '东'}闸门正在${action === 'OPENING' ? '开启' : '关闭'}！`
  ).replace(
    /^(.+) DETONATED \((\d+) killed\)$/,
    (_, label, count) => `💥 ${label} 引爆 · 消灭 ${count} 只感染者！`
  );
}

export function translateCommanderOrder(order: string): string {
  return order
    .replace('Monitoring the outbreak', '监控疫情')
    .replace('Stand down', '待命')
    .replace('Ordered a strike on a zombie pile', '已下令打击尸堆')
    .replace(/Falling back to Line (\d+)/, '正在撤往第$1道防线')
    .replace('Falling back to the KTX forecourt', '正在撤往 KTX 站前广场')
    .replace('Falling back to Airlock Beta Killzone', '正在撤往 Beta 气密闸杀伤走廊')
    .replace('Falling back to the Extraction Garage', '正在撤往撤离车库防线')
    .replace('Falling back to the inner city', '正在撤往内城区')
    .replace(/Sent SWAT to Line (\d+)/, '已派特种部队增援第$1道防线')
    .replace(/Sent a patrol to (.+)/, (_, district: string) => `已派巡逻队前往${translateWorldLabel(district)}`);
}
