/**
 * sketch.js
 * ─────────────────────────────────────────────────────────────
 * SignPlay 主程式（p5.js sketch）
 *
 * 遊戲狀態機：
 *
 *   IDLE  ──[比1]──→  LEARN  ──[完成全部]──→  GAME
 *     ↑                 │                        │
 *     │              [比2跳過]                [時間到]
 *     │                 ↓                        ↓
 *     └──[OK]──── RESULT  ←──────────────── RESULT
 *                   │
 *                [比2]→ 再玩一次 → GAME
 *
 * 版面配置：
 *
 *   ┌────────────────────────────────────────────┐
 *   │  標題列（Header）                           │
 *   ├────────────────┬───────────────────────────┤
 *   │                │                           │
 *   │  攝影機畫面    │   遊戲主畫面              │
 *   │  + 骨架疊圖    │   (IDLE/LEARN/GAME/RESULT)│
 *   │                │                           │
 *   ├────────────────┤                           │
 *   │  手勢標籤      │                           │
 *   ├────────────────┴───────────────────────────┤
 *   │  信心值進度條（底部）                       │
 *   └────────────────────────────────────────────┘
 */

'use strict';

// ══════════════════════════════════════════════════════════════
//   全域變數宣告
// ══════════════════════════════════════════════════════════════

// ── 診斷用：若初始化失敗，這裡存放錯誤訊息 ──────────────────
let appError = null;

// ── p5.js 物件 ───────────────────────────────────────────────
let video;         // webcam 影像捕捉
let handpose;      // ml5 Handpose 實例
let classifier;    // GestureClassifier 實例

// ── 手勢辨識資料 ─────────────────────────────────────────────
let currentHands  = [];    // ml5 每幀偵測到的手部列表
let modelLoaded   = false; // AI 模型是否載入完成

let instantGesture   = { gesture: 'UNKNOWN', confidence: 0, tips: [] };
let confirmedGesture = { gesture: 'UNKNOWN', confidence: 0, tips: [] };

// ── 遊戲狀態 ─────────────────────────────────────────────────
let gameState = 'IDLE'; // 'IDLE' | 'LEARN' | 'GAME' | 'RESULT'

// 動作冷卻：防止同一手勢短時間內觸發多次
let lastActionTime  = 0;
const ACTION_COOLDOWN = 900; // 毫秒（ms）

// ── Learn Mode 狀態 ──────────────────────────────────────────
let learnIdx           = 0;     // 目前練習的手勢索引（0 ~ LEARN_SEQUENCE.length-1）
let learnSuccessTimer  = 0;     // 成功時間戳（millis()），0 = 未成功
const LEARN_SUCCESS_DELAY = 1300; // 成功後展示幾毫秒再切換

// ── Game Mode 狀態 ───────────────────────────────────────────
let score         = 0;
let timeLeft      = 90;    // 剩餘秒數
let combo         = 0;     // 連擊數
let maxCombo      = 0;     // 本局最高連擊
let correctCount  = 0;     // 答對次數
let totalAttempts = 0;     // 總嘗試次數
let currentTarget = '';    // 當前題目（手勢名稱）

// 答對回饋動畫
let correctFeedback       = false;
let correctFeedbackTimer  = 0;
const CORRECT_DURATION    = 700; // ms

// 答錯回饋動畫
let wrongFeedback       = false;
let wrongFeedbackTimer  = 0;
let wrongGuessName      = ''; // 玩家比了什麼
const WRONG_DURATION    = 1300; // ms

// ── Result Mode 狀態 ─────────────────────────────────────────
let finalScore    = 0;
let finalAccuracy = 0;
let finalMaxCombo = 0;
let finalCorrect  = 0;
let finalTotal    = 0;

// ── 版面參數（由 _computeLayout() 計算）─────────────────────
let CAM_X, CAM_Y, CAM_W, CAM_H;          // 攝影機保留區域（含 letterbox 空間）
let CAM_DRAW_X, CAM_DRAW_Y,
    CAM_DRAW_W, CAM_DRAW_H;              // 實際影像繪製區域（長寬比修正後）
let PANEL_X, PANEL_W, PANEL_Y;           // 右側遊戲面板
let isMobile = false;                    // 是否為窄螢幕 / 縱向模式
const HEADER_H = 58;
let BOTTOM_H = 68;

// ── 當前遊戲題目 ─────────────────────────────────────────────
let currentQuestion = { text: '', note: '' };

// ── 確認彈窗狀態 ─────────────────────────────────────────────
let confirmMode = '';   // 要前往的模式：'LEARN' | 'GAME'
let confirmFrom = '';   // 來源狀態：'IDLE' | 'LEARN'

// ── 色彩常數（教育科技風格配色）────────────────────────────
const C = {
  BG:       '#0F172A',  // 深夜藍（主背景）
  PANEL:    '#1E293B',  // 面板背景
  CARD:     '#263347',  // 卡片/元素背景
  BORDER:   '#334155',  // 邊框顏色
  PRIMARY:  '#2563EB',  // 主色（藍）
  SUCCESS:  '#22C55E',  // 成功（綠）
  DANGER:   '#EF4444',  // 錯誤（紅）
  WARNING:  '#F59E0B',  // 警告（橙）
  TEXT:     '#F1F5F9',  // 主要文字（亮白）
  MUTED:    '#94A3B8',  // 次要文字（灰）
};

// ══════════════════════════════════════════════════════════════
//   p5.js 核心函式
// ══════════════════════════════════════════════════════════════

/**
 * setup() — 初始化（只執行一次）
 */
function setup() {
  createCanvas(windowWidth, windowHeight);
  frameRate(30);
  textFont('sans-serif'); // 明確指定字型，避免部分系統找不到預設字型

  _computeLayout();
  classifier = new GestureClassifier();

  // ── webcam ────────────────────────────────────────────────
  video = createCapture(VIDEO, () => { console.log('✅ webcam 就緒'); });
  // 不強制指定尺寸，讓瀏覽器使用鏡頭的原生解析度
  // 骨架座標映射會自動讀取 video.elt.videoWidth/videoHeight 來修正
  video.hide();

  // ── ml5 存在性檢查 ───────────────────────────────────────
  if (typeof ml5 === 'undefined') {
    appError = [
      '⚠️  ml5.js 未載入',
      '',
      '可能原因：',
      '  • 廣告攔截器（uBlock 等）封鎖了 unpkg.com',
      '  • 網路無法連到外部 CDN',
      '',
      '解決方法：',
      '  1. 暫時停用廣告攔截器，重新整理頁面',
      '  2. 或把 ml5.min.js 下載到本機（見下方說明）',
      '',
      '本機方法：',
      '  下載 https://unpkg.com/ml5@0.12.2/dist/ml5.min.js',
      '  存成 SignPlay/ml5.min.js',
      '  修改 index.html 的 src 為 ./ml5.min.js',
    ].join('\n');
    console.error('❌ ml5 is not defined');
    return;
  }

  // ── 初始化 Handpose ──────────────────────────────────────
  try {
    handpose = ml5.handpose(video, { maxNumHands: 1 }, () => {
      modelLoaded = true;
      console.log('🤖 Handpose 載入完成');
    });
    handpose.on('predict', (results) => { currentHands = results; });
    console.log('🎮 SignPlay 啟動');
  } catch (e) {
    appError = '⚠️  ml5.handPose 初始化失敗\n\n' + e.message;
    console.error('❌ ml5 初始化錯誤:', e);
  }
}

/**
 * windowResized() — 視窗大小改變時重新計算版面
 */
function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  _computeLayout();
}

/**
 * draw() — 主繪圖迴圈（每幀執行）
 */
function draw() {
  background(C.BG);

  // ── 若有初始化錯誤，直接顯示錯誤訊息 ──────────────────
  if (appError) {
    _drawError(appError);
    return;
  }

  // ── 重置文字狀態，防止 textStyle(BOLD) 被留下 ──────────
  textStyle(NORMAL);
  textFont('sans-serif');

  try {
    // 1. 處理手勢辨識
    _processGesture();

    // 2. 繪製固定 UI 元素
    _drawHeader();
    _drawCameraPanel();
    _drawConfidenceBar();

    // 3. 根據遊戲狀態繪製右側主畫面
    if (!modelLoaded) {
      _drawLoading();
    } else if (gameState === 'IDLE')    { _drawIdle();
    } else if (gameState === 'CONFIRM') { _drawConfirm();
    } else if (gameState === 'LEARN')   { _drawLearn();
    } else if (gameState === 'GAME')    { _drawGame();
    } else if (gameState === 'RESULT')  { _drawResult();
    }

    // 4. 遊戲邏輯更新
    _updateGameLogic();

    // 5. 手勢輸入處理
    _handleGestureInput();

  } catch (e) {
    // 若 draw() 內部出現錯誤，顯示在畫面上供除錯
    console.error('draw() 發生錯誤:', e);
    _drawError('draw() 執行錯誤\n\n' + e.name + ': ' + e.message + '\n\n請開啟 F12 Console 查看詳細資訊');
  }
}

/**
 * 在畫面上顯示錯誤訊息（紅色框框）
 */
function _drawError(msg) {
  // 背景
  fill('#1A0A0A');
  noStroke();
  rect(0, 0, width, height);

  // 錯誤標題
  fill('#EF4444');
  textFont('sans-serif');
  textStyle(BOLD);
  textSize(18);
  textAlign(LEFT, TOP);
  text('❌ SignPlay 初始化失敗', 40, 60);
  textStyle(NORMAL);

  // 錯誤訊息
  fill('#FECACA');
  textSize(14);
  text(msg, 40, 110);

  // 底部提示
  fill('#6B7280');
  textSize(12);
  text('請按 F12 開啟開發者工具 → Console 頁籤查看完整錯誤訊息', 40, height - 40);
}

// ══════════════════════════════════════════════════════════════
//   版面計算
// ══════════════════════════════════════════════════════════════

function _computeLayout() {
  // 判斷行動裝置：寬度不足 650 或縱向模式（height > width）
  isMobile = width < 650 || height > width;
  BOTTOM_H = isMobile ? 54 : 68;

  if (isMobile) {
    // ── 行動版：攝影機在上，遊戲面板在下 ──────────────────
    CAM_W = min(width - 24, 400);
    CAM_H = floor(CAM_W * 0.65); // 略扁，留更多空間給下方
    CAM_X = floor((width - CAM_W) / 2);
    CAM_Y = HEADER_H + 4;

    PANEL_X = 0;
    PANEL_W = width;
    PANEL_Y = CAM_Y + CAM_H + 50; // 攝影機下方留 50px 給手勢標籤
  } else {
    // ── 桌機版：左右並排 ────────────────────────────────
    CAM_W = min(floor(width * 0.44), 520);
    CAM_H = floor(CAM_W * 0.75);
    CAM_X = 18;
    const availH = height - HEADER_H - BOTTOM_H;
    CAM_Y = HEADER_H + floor((availH - CAM_H - 48) / 2);

    PANEL_X = CAM_X + CAM_W + 20;
    PANEL_W = width - PANEL_X - 16;
    PANEL_Y = HEADER_H;
  }

  // 預設與 CAM 區域相同，會在 _drawCameraPanel 依實際解析度修正
  CAM_DRAW_X = CAM_X; CAM_DRAW_Y = CAM_Y;
  CAM_DRAW_W = CAM_W; CAM_DRAW_H = CAM_H;
}

// ══════════════════════════════════════════════════════════════
//   手勢辨識處理
// ══════════════════════════════════════════════════════════════

function _processGesture() {
  if (currentHands.length > 0 && modelLoaded) {
    // 有偵測到手：進行辨識
    instantGesture   = classifier.classifyGesture(currentHands[0]);
    confirmedGesture = classifier.getConfirmed();
  } else {
    // 沒有手：重置
    if (currentHands.length === 0) {
      classifier.reset();
    }
    instantGesture   = { gesture: 'UNKNOWN', confidence: 0, tips: ['請將手放入鏡頭'] };
    confirmedGesture = { gesture: 'UNKNOWN', confidence: 0, tips: [] };
  }
}

// ══════════════════════════════════════════════════════════════
//   繪製：標題列
// ══════════════════════════════════════════════════════════════

function _drawHeader() {
  // 背景
  fill(C.PANEL);
  noStroke();
  rect(0, 0, width, HEADER_H);

  // 底部分隔線
  stroke(C.BORDER);
  strokeWeight(1);
  line(0, HEADER_H, width, HEADER_H);
  noStroke();

  // 遊戲標題
  fill(C.TEXT);
  textSize(20);
  textAlign(LEFT, CENTER);
  textStyle(BOLD);
  text('✋ SignPlay', 20, HEADER_H / 2);
  textStyle(NORMAL);

  // 狀態標籤（彩色小徽章）
  const stateInfo = {
    IDLE:    { label: '等待開始', color: C.MUTED },
    CONFIRM: { label: '確認中',   color: C.WARNING },
    LEARN:   { label: '學習模式', color: C.PRIMARY },
    GAME:    { label: '遊戲模式', color: C.SUCCESS },
    RESULT:  { label: '結果畫面', color: C.WARNING },
  };
  const si = stateInfo[gameState];
  if (si) {
    const lx = 176, lw = 84, lh = 26;
    fill(si.color);
    rect(lx, (HEADER_H - lh) / 2, lw, lh, 6);
    fill(C.BG);
    textSize(12);
    textAlign(CENTER, CENTER);
    text(si.label, lx + lw / 2, HEADER_H / 2);
  }

  // 右上角：手部偵測狀態
  const handDetected = currentHands.length > 0;
  fill(handDetected ? C.SUCCESS : C.MUTED);
  circle(width - 28, HEADER_H / 2, 10);

  fill(C.MUTED);
  textSize(12);
  textAlign(RIGHT, CENTER);
  text(handDetected ? '手部偵測中' : '未偵測到手', width - 40, HEADER_H / 2);

  // Game mode：顯示即時分數
  if (gameState === 'GAME') {
    fill(C.WARNING);
    textSize(14);
    textAlign(RIGHT, CENTER);
    textStyle(BOLD);
    text(`${score} 分`, width - 130, HEADER_H / 2);
    textStyle(NORMAL);
  }
}

// ══════════════════════════════════════════════════════════════
//   繪製：攝影機面板（左側）
// ══════════════════════════════════════════════════════════════

function _drawCameraPanel() {
  // 左側面板背景
  fill(C.PANEL);
  noStroke();
  rect(0, HEADER_H, CAM_X + CAM_W + 10, height - HEADER_H);

  // ── 取得實際鏡頭解析度，計算正確的長寬比 ───────────────
  // videoWidth/videoHeight 是鏡頭的原生解析度（可能是 1280×720 或其他）
  // 如果直接用 CAM_W × CAM_H 顯示，影像會被拉伸/壓縮
  const vW = (video.elt && video.elt.videoWidth)  || 640;
  const vH = (video.elt && video.elt.videoHeight) || 480;
  const vidAspect = vW / vH;

  // 在保留區域（CAM_W × CAM_H）內，算出不變形的實際繪製大小
  CAM_DRAW_W = CAM_W;
  CAM_DRAW_H = floor(CAM_W / vidAspect);
  if (CAM_DRAW_H > CAM_H) {     // 若高度超過保留區 → 改以高度為準
    CAM_DRAW_H = CAM_H;
    CAM_DRAW_W = floor(CAM_H * vidAspect);
  }
  // 置中放置（letterbox / pillarbox 效果）
  CAM_DRAW_X = CAM_X + floor((CAM_W - CAM_DRAW_W) / 2);
  CAM_DRAW_Y = CAM_Y + floor((CAM_H - CAM_DRAW_H) / 2);

  // ── 攝影機影像（水平鏡像顯示）──────────────────────────
  const videoReady = video && video.elt && video.elt.readyState >= 2;

  if (videoReady) {
    push();
    translate(CAM_DRAW_X + CAM_DRAW_W, CAM_DRAW_Y);
    scale(-1, 1);
    image(video, 0, 0, CAM_DRAW_W, CAM_DRAW_H);
    pop();
  } else {
    // 攝影機未就緒時的佔位框
    fill(C.CARD);
    noStroke();
    rect(CAM_X, CAM_Y, CAM_W, CAM_H, 6);
    fill(C.MUTED);
    textSize(13);
    textAlign(CENTER, CENTER);
    text('正在開啟攝影機...', CAM_X + CAM_W / 2, CAM_Y + CAM_H / 2);
  }

  // ── 手部骨架與關鍵點 ────────────────────────────────────
  if (currentHands.length > 0 && modelLoaded) {
    _drawHandSkeleton(currentHands[0]);
  }

  // ── 攝影機邊框 ──────────────────────────────────────────
  noFill();
  stroke(C.BORDER);
  strokeWeight(1.5);
  rect(CAM_X, CAM_Y, CAM_W, CAM_H, 6);
  noStroke();

  // ── 當前辨識手勢標籤（攝影機下方）──────────────────────
  _drawGestureLabel();
}

/**
 * 繪製手部骨架（21 個關鍵點 + 手指連線）
 * 座標對應：ml5 輸出的是原始影像座標，需要：
 *   1. 縮放到攝影機顯示區域大小
 *   2. 水平翻轉（因為我們顯示鏡像影像）
 */
function _drawHandSkeleton(hand) {
  if (!hand.landmarks) return;

  const lm = hand.landmarks;

  // 使用鏡頭原生解析度作為座標基準（不是 video.width/height 的顯示大小）
  // 這樣才能讓骨架精準疊在影像上，手機鏡頭解析度不同也不會偏移
  const vW = (video.elt && video.elt.videoWidth)  || 640;
  const vH = (video.elt && video.elt.videoHeight) || 480;

  // 映射到實際影像繪製區域（已考慮 letterbox 偏移 + 長寬比）
  const mx = (x) => CAM_DRAW_X + CAM_DRAW_W - (x / vW) * CAM_DRAW_W; // 水平翻轉
  const my = (y) => CAM_DRAW_Y + (y / vH) * CAM_DRAW_H;

  // 從 landmark 陣列取出畫布座標
  const getPos = (i) => {
    const p  = lm[i];
    const px = Array.isArray(p) ? p[0] : p.x;
    const py = Array.isArray(p) ? p[1] : p.y;
    return { x: mx(px), y: my(py) };
  };

  // ── 骨架連線定義 ──────────────────────────────────────
  const connections = [
    [0, 1], [1, 2], [2, 3], [3, 4],          // 拇指
    [0, 5], [5, 6], [6, 7], [7, 8],          // 食指
    [0, 9], [9, 10], [10, 11], [11, 12],     // 中指
    [0, 13], [13, 14], [14, 15], [15, 16],   // 無名指
    [0, 17], [17, 18], [18, 19], [19, 20],   // 小指
    [5, 9], [9, 13], [13, 17],               // 掌骨橫向
  ];

  // 取當前辨識手勢的顏色
  const g = GESTURES[instantGesture.gesture] || GESTURES.UNKNOWN;

  // 繪製骨架線（使用手勢顏色，半透明）
  const gC = _parseHex(g.color);
  stroke(gC[0], gC[1], gC[2], 170);
  strokeWeight(2);
  for (const [a, b] of connections) {
    const pa = getPos(a);
    const pb = getPos(b);
    line(pa.x, pa.y, pb.x, pb.y);
  }

  // 繪製關鍵點（指尖用較大亮點）
  const tipIndices = new Set([4, 8, 12, 16, 20]);
  noStroke();
  for (let i = 0; i < 21; i++) {
    const p = getPos(i);
    const isTip = tipIndices.has(i);

    // 白色外圈
    fill(255, 255, 255, isTip ? 230 : 160);
    circle(p.x, p.y, isTip ? 12 : 8);

    // 彩色內圈
    fill(gC[0], gC[1], gC[2], 255);
    circle(p.x, p.y, isTip ? 7 : 4);
  }

  noStroke();
}

/**
 * 在攝影機下方顯示即時辨識手勢名稱
 */
function _drawGestureLabel() {
  const lx = CAM_X;
  const ly = CAM_Y + CAM_H + 6;
  const lw = CAM_W;
  const lh = 40;

  fill(C.CARD);
  noStroke();
  rect(lx, ly, lw, lh, 4);

  // 即時辨識結果（左側）
  const ig = GESTURES[instantGesture.gesture] || GESTURES.UNKNOWN;
  const igC = _parseHex(ig.color);
  fill(igC[0], igC[1], igC[2]);
  textSize(14);
  textAlign(LEFT, CENTER);
  text(`${ig.emoji}  ${ig.label}`, lx + 12, ly + lh / 2);

  // 已確認手勢（右側，成功確認後顯示）
  if (confirmedGesture.gesture !== 'UNKNOWN') {
    const cg = GESTURES[confirmedGesture.gesture] || GESTURES.UNKNOWN;
    fill(C.SUCCESS);
    textSize(12);
    textAlign(RIGHT, CENTER);
    text(`✓ ${cg.label}`, lx + lw - 10, ly + lh / 2);
  }
}

// ══════════════════════════════════════════════════════════════
//   繪製：信心值進度條（底部）
// ══════════════════════════════════════════════════════════════

function _drawConfidenceBar() {
  const bx = CAM_X;
  const by = height - BOTTOM_H;
  const bw = CAM_W;
  const bh = BOTTOM_H;

  // 背景
  fill(C.PANEL);
  noStroke();
  rect(bx, by, bw + 10, bh);

  // 標題文字
  fill(C.MUTED);
  textSize(11);
  textAlign(LEFT, TOP);
  text('辨識信心值', bx + 8, by + 8);

  // 百分比數字
  const confPct = floor(instantGesture.confidence * 100);
  const ig      = GESTURES[instantGesture.gesture] || GESTURES.UNKNOWN;
  const igC     = _parseHex(ig.color);

  fill(confPct > 60 ? color(igC[0], igC[1], igC[2]) : C.MUTED);
  textSize(13);
  textStyle(BOLD);
  textAlign(RIGHT, TOP);
  text(`${confPct}%`, bx + bw - 8, by + 7);
  textStyle(NORMAL);

  // 進度條軌道
  const barX = bx + 8;
  const barY = by + 30;
  const barW = bw - 16;
  const barH = 10;

  fill(C.CARD);
  noStroke();
  rect(barX, barY, barW, barH, 5);

  // 進度條填充
  if (instantGesture.confidence > 0) {
    fill(igC[0], igC[1], igC[2]);
    rect(barX, barY, barW * instantGesture.confidence, barH, 5);
  }

  // 提示文字（最多顯示一條）
  if (instantGesture.tips && instantGesture.tips.length > 0) {
    fill(C.MUTED);
    textSize(11);
    textAlign(LEFT, BOTTOM);
    text(`💡 ${instantGesture.tips[0]}`, bx + 8, height - 6);
  }
}

// ══════════════════════════════════════════════════════════════
//   繪製：載入中畫面
// ══════════════════════════════════════════════════════════════

function _drawLoading() {
  const cx = PANEL_X + PANEL_W / 2;
  const cy = HEADER_H + (height - HEADER_H - BOTTOM_H) / 2;

  fill(C.TEXT);
  textSize(40);
  textAlign(CENTER, CENTER);
  text('🤖', cx, cy - 50);

  textSize(18);
  text('正在載入 AI 模型…', cx, cy);

  fill(C.MUTED);
  textSize(13);
  text('首次載入需要 10~30 秒，請稍候', cx, cy + 34);

  // 跑馬燈動畫
  const dotCount = floor(millis() / 500) % 4;
  fill(C.PRIMARY);
  textSize(20);
  text('●'.repeat(dotCount) + '○'.repeat(3 - dotCount), cx, cy + 68);
}

// ══════════════════════════════════════════════════════════════
//   繪製：IDLE 畫面（等待開始）
// ══════════════════════════════════════════════════════════════

function _drawIdle() {
  const cx     = PANEL_X + PANEL_W / 2;
  const startY = PANEL_Y;

  // 大標題
  fill(C.TEXT);
  textSize(44);
  textStyle(BOLD);
  textAlign(CENTER, TOP);
  text('SignPlay', cx, startY + 28);
  textStyle(NORMAL);

  // 副標題
  fill(C.MUTED);
  textSize(15);
  text('用手勢控制的 AI 互動學習遊戲', cx, startY + 84);

  // ── 操作選項卡 ──────────────────────────────────────────
  const cardW = min(PANEL_W - 48, 340);
  const cardX = cx - cardW / 2;

  _drawActionCard(
    cardX, startY + 128, cardW, 98,
    '☝️  比 1 — 學習模式',
    '依序練習 7 個手勢，有即時辨識回饋',
    C.PRIMARY,
    confirmedGesture.gesture === 'ONE'
  );

  _drawActionCard(
    cardX, startY + 244, cardW, 98,
    '✌️  比 2 — 遊戲模式',
    '90 秒倒計時挑戰，答對得分',
    C.SUCCESS,
    confirmedGesture.gesture === 'TWO'
  );

  // ── 手勢圖示列 ──────────────────────────────────────────
  const iconY = startY + 376;
  fill(C.MUTED);
  textSize(12);
  textAlign(CENTER, TOP);
  text('支援手勢', cx, iconY);

  const icons   = Object.values(GESTURES)
    .filter(g => g.name !== 'UNKNOWN')
    .map(g => g.emoji);
  const spacing = min(PANEL_W / (icons.length + 1), 46);
  textSize(26);
  for (let i = 0; i < icons.length; i++) {
    const ix = cx - (icons.length - 1) * spacing / 2 + i * spacing;
    text(icons[i], ix, iconY + 20);
  }
}

/**
 * 繪製 IDLE 畫面的操作選項卡
 */
function _drawActionCard(x, y, w, h, title, desc, accentColor, isActive) {
  // 卡片背景
  fill(isActive ? _hexWithAlpha(accentColor, 30) : C.CARD);
  stroke(isActive ? accentColor : C.BORDER);
  strokeWeight(isActive ? 2 : 1);
  rect(x, y, w, h, 10);
  noStroke();

  // 左側彩色邊條
  fill(accentColor);
  rect(x, y, 5, h, 10, 0, 0, 10);

  // 標題
  fill(C.TEXT);
  textSize(17);
  textStyle(BOLD);
  textAlign(LEFT, TOP);
  text(title, x + 18, y + 18);
  textStyle(NORMAL);

  // 描述
  fill(C.MUTED);
  textSize(13);
  text(desc, x + 18, y + 52);
}

// ══════════════════════════════════════════════════════════════
//   繪製：LEARN 模式（學習練習）
// ══════════════════════════════════════════════════════════════

function _drawLearn() {
  const cx      = PANEL_X + PANEL_W / 2;
  const startY  = PANEL_Y + 12;
  const total   = LEARN_SEQUENCE.length;
  const target  = LEARN_SEQUENCE[learnIdx];
  const g       = GESTURES[target];
  const gC      = _parseHex(g.color);
  const isSuccess = learnSuccessTimer > 0;

  // ── 進度列 ──────────────────────────────────────────────
  fill(C.MUTED);
  textSize(12);
  textAlign(LEFT, TOP);
  text(`進度  ${learnIdx + 1} / ${total}`, PANEL_X + 8, startY + 4);

  // 進度點（圓形指示器）
  const dotR      = 10;
  const dotSpacing = min(PANEL_W / (total + 1), 36);
  const dotsStartX = cx - (total - 1) * dotSpacing / 2;

  for (let i = 0; i < total; i++) {
    const dx = dotsStartX + i * dotSpacing;
    const dy = startY + 16;

    if (i < learnIdx) {
      // 已完成（綠色打勾）
      fill(C.SUCCESS);
      circle(dx, dy, dotR * 2);
      fill(C.BG);
      textSize(10);
      textAlign(CENTER, CENTER);
      text('✓', dx, dy);
    } else if (i === learnIdx) {
      // 當前（手勢顏色）
      fill(gC[0], gC[1], gC[2]);
      circle(dx, dy, dotR * 2.2);
    } else {
      // 未到（暗色）
      fill(C.CARD);
      stroke(C.BORDER);
      strokeWeight(1);
      circle(dx, dy, dotR * 2);
      noStroke();
    }
  }

  // ── 目標手勢卡片 ────────────────────────────────────────
  const cardW = min(PANEL_W - 40, 340);
  const cardX = cx - cardW / 2;
  const cardY = startY + 48;
  const cardH = 196;

  fill(isSuccess ? '#0E3320' : C.CARD);
  stroke(isSuccess ? C.SUCCESS : color(gC[0], gC[1], gC[2]));
  strokeWeight(isSuccess ? 2.5 : 1.5);
  rect(cardX, cardY, cardW, cardH, 12);
  noStroke();

  // 手勢 Emoji
  textSize(64);
  textAlign(CENTER, CENTER);
  text(g.emoji, cx, cardY + 80);

  // 手勢名稱
  fill(isSuccess ? C.SUCCESS : color(gC[0], gC[1], gC[2]));
  textSize(22);
  textStyle(BOLD);
  textAlign(CENTER, TOP);
  text(g.label, cx, cardY + 150);
  textStyle(NORMAL);

  // 操作說明
  fill(C.MUTED);
  textSize(13);
  text(g.instruction, cx, cardY + 178);

  // ── 辨識狀態提示 ────────────────────────────────────────
  const statusY = cardY + cardH + 18;

  if (isSuccess) {
    // 成功動畫
    fill(C.SUCCESS);
    textSize(22);
    textAlign(CENTER, TOP);
    text('🎉 太棒了！成功辨識！', cx, statusY);

    fill(C.MUTED);
    textSize(13);
    const remaining = max(0, (LEARN_SUCCESS_DELAY - (millis() - learnSuccessTimer)) / 1000);
    text(`${remaining.toFixed(1)} 秒後進入下一個手勢…`, cx, statusY + 30);

  } else {
    // 顯示目前辨識狀態
    const ig  = GESTURES[instantGesture.gesture] || GESTURES.UNKNOWN;
    const igC = _parseHex(ig.color);

    fill(C.MUTED);
    textSize(13);
    textAlign(CENTER, TOP);
    text('目前辨識：', cx - 52, statusY + 3);

    fill(igC[0], igC[1], igC[2]);
    textSize(16);
    text(`${ig.emoji} ${ig.label}`, cx + 32, statusY + 2);

    // 是否接近目標
    if (instantGesture.gesture === target) {
      fill(C.SUCCESS);
      textSize(14);
      textAlign(CENTER, TOP);
      text('✓ 正確！請保持此手勢…', cx, statusY + 32);
    } else if (instantGesture.gesture !== 'UNKNOWN') {
      fill(C.WARNING);
      textSize(13);
      textAlign(CENTER, TOP);
      text('繼續嘗試，快了！', cx, statusY + 32);
    } else {
      fill(C.MUTED);
      textSize(13);
      textAlign(CENTER, TOP);
      text('請將手放入鏡頭，做出上方手勢', cx, statusY + 32);
    }

    // 改善提示
    if (instantGesture.tips && instantGesture.tips.length > 0) {
      fill(C.MUTED);
      textSize(12);
      textAlign(CENTER, TOP);
      text(`💡 ${instantGesture.tips[0]}`, cx, statusY + 58);
    }
  }

  // ── 底部提示 ────────────────────────────────────────────
  fill(C.MUTED);
  textSize(11);
  textAlign(CENTER, BOTTOM);
  text('比 ✌️ 跳過學習，直接進入遊戲模式', cx, height - BOTTOM_H - 8);
}

// ══════════════════════════════════════════════════════════════
//   繪製：GAME 模式（遊戲挑戰）
// ══════════════════════════════════════════════════════════════

function _drawGame() {
  const cx     = PANEL_X + PANEL_W / 2;
  const startY = PANEL_Y + 6;

  // ── 頂部：計時器 / Combo ────────────────────────────────
  const timerColor = timeLeft <= 15 ? C.DANGER : (timeLeft <= 30 ? C.WARNING : C.TEXT);

  fill(timerColor);
  textSize(28);
  textStyle(BOLD);
  textAlign(LEFT, TOP);
  const mins = floor(timeLeft / 60);
  const secs = floor(timeLeft % 60);
  text(`${nf(mins, 1)}:${nf(secs, 2)}`, PANEL_X + 8, startY + 2);
  textStyle(NORMAL);

  if (combo >= 2) {
    const comboColor = combo >= 5 ? C.DANGER : (combo >= 3 ? C.WARNING : C.SUCCESS);
    fill(comboColor);
    textSize(18);
    textStyle(BOLD);
    textAlign(RIGHT, TOP);
    text(`× ${combo} COMBO`, PANEL_X + PANEL_W - 8, startY + 6);
    textStyle(NORMAL);
  }

  // 計時進度條
  const barY = startY + 42;
  fill(C.CARD);
  rect(PANEL_X, barY, PANEL_W, 5, 2);
  fill(timerColor);
  rect(PANEL_X, barY, PANEL_W * (timeLeft / 90), 5, 2);

  // ── 題目卡片 ────────────────────────────────────────────
  const g    = GESTURES[currentTarget] || GESTURES.UNKNOWN;
  const gC   = _parseHex(g.color);
  const cardW = min(PANEL_W - 20, 360);
  const cardX = cx - cardW / 2;
  const cardY = barY + 10;
  const cardH = isMobile ? 200 : 230;

  let cardBg     = C.CARD;
  let cardBorder = color(gC[0], gC[1], gC[2]);
  let borderW    = 1.5;
  if (correctFeedback) { cardBg = '#0A2E1A'; cardBorder = color(C.SUCCESS); borderW = 3; }
  else if (wrongFeedback) { cardBg = '#2A1010'; cardBorder = color(C.DANGER); borderW = 3; }

  fill(cardBg);
  stroke(cardBorder);
  strokeWeight(borderW);
  rect(cardX, cardY, cardW, cardH, 12);
  noStroke();

  // ── 問題文字（教育核心）──────────────────────────────
  fill(C.TEXT);
  textSize(isMobile ? 17 : 20);
  textStyle(BOLD);
  textAlign(CENTER, TOP);
  text(currentQuestion.text || '請做出下方手勢', cx, cardY + 14);
  textStyle(NORMAL);

  // 說明/提示文字
  if (currentQuestion.note) {
    fill(C.MUTED);
    textSize(12);
    text(currentQuestion.note, cx, cardY + (isMobile ? 42 : 46));
  }

  // 分隔線
  const divY = cardY + (isMobile ? 62 : 72);
  stroke(C.BORDER);
  strokeWeight(1);
  line(cardX + 20, divY, cardX + cardW - 20, divY);
  noStroke();

  // 答案手勢（Emoji + 名稱 + 操作說明）
  fill(C.MUTED);
  textSize(11);
  textAlign(CENTER, TOP);
  text('做出這個手勢', cx, divY + 6);

  textSize(isMobile ? 52 : 60);
  textAlign(CENTER, CENTER);
  text(g.emoji, cx, divY + (isMobile ? 46 : 56));

  fill(color(gC[0], gC[1], gC[2]));
  textSize(isMobile ? 16 : 18);
  textStyle(BOLD);
  textAlign(CENTER, TOP);
  text(g.label, cx, cardY + cardH - (isMobile ? 40 : 46));
  textStyle(NORMAL);

  fill(C.MUTED);
  textSize(11);
  text(g.instruction, cx, cardY + cardH - (isMobile ? 22 : 24));

  // ── 回饋訊息 ────────────────────────────────────────────
  const fbY = cardY + cardH + 10;

  if (correctFeedback) {
    fill(C.SUCCESS);
    textSize(18);
    textStyle(BOLD);
    textAlign(CENTER, TOP);
    text('🎉 答對了！', cx, fbY);
    textStyle(NORMAL);
    const bonus = combo >= 5 ? 10 : (combo >= 3 ? 5 : 0);
    fill(C.SUCCESS);
    textSize(13);
    text(`+${10 + bonus} 分${bonus > 0 ? `（Combo +${bonus}）` : ''}`, cx, fbY + 26);

  } else if (wrongFeedback) {
    fill(C.DANGER);
    textSize(17);
    textStyle(BOLD);
    textAlign(CENTER, TOP);
    text('❌ 不對喔！', cx, fbY);
    textStyle(NORMAL);
    const wg = GESTURES[wrongGuessName] || GESTURES.UNKNOWN;
    fill(C.MUTED);
    textSize(12);
    text(`你比的是 ${wg.emoji} ${wg.label}，需要 ${g.emoji} ${g.label}`, cx, fbY + 26);

  } else {
    const ig  = GESTURES[instantGesture.gesture] || GESTURES.UNKNOWN;
    const igC = _parseHex(ig.color);
    fill(C.MUTED);
    textSize(12);
    textAlign(CENTER, TOP);
    text('目前辨識：', cx - 38, fbY + 4);
    fill(igC[0], igC[1], igC[2]);
    textSize(15);
    text(`${ig.emoji} ${ig.label}`, cx + 32, fbY + 2);
  }

  if (totalAttempts > 0) {
    const acc = floor((correctCount / totalAttempts) * 100);
    fill(C.MUTED);
    textSize(11);
    textAlign(CENTER, BOTTOM);
    text(`正確率 ${acc}%（${correctCount} / ${totalAttempts} 題）`, cx, height - BOTTOM_H - 6);
  }
}

// ══════════════════════════════════════════════════════════════
//   繪製：RESULT 畫面（成績結算）
// ══════════════════════════════════════════════════════════════

function _drawResult() {
  const cx = PANEL_X + PANEL_W / 2;
  const sy = PANEL_Y + 14;

  // 標題
  fill(C.TEXT);
  textSize(30);
  textStyle(BOLD);
  textAlign(CENTER, TOP);
  text('🏁 遊戲結束！', cx, sy);
  textStyle(NORMAL);

  // ── 統計卡片 ────────────────────────────────────────────
  const statCount = 3;
  const statW     = min((PANEL_W - 56) / statCount, 118);
  const statH     = 88;
  const statY     = sy + 54;
  const statsW    = statW * statCount + 20;
  const statStartX = cx - statsW / 2;

  _drawStatCard(statStartX,               statY, statW, statH, '總分',    `${finalScore}`,    C.WARNING);
  _drawStatCard(statStartX + statW + 10,  statY, statW, statH, '正確率',  `${finalAccuracy}%`, C.SUCCESS);
  _drawStatCard(statStartX + (statW+10)*2, statY, statW, statH, '最高連擊', `${finalMaxCombo}×`, C.PRIMARY);

  // ── 詳細文字 ─────────────────────────────────────────────
  const detY = statY + statH + 22;
  fill(C.MUTED);
  textSize(14);
  textAlign(CENTER, TOP);
  text(`答對 ${finalCorrect} 題 / 共嘗試 ${finalTotal} 次`, cx, detY);

  // ── 評語 ────────────────────────────────────────────────
  let comment;
  if (finalScore >= 200)      comment = '🏆 太強了！你是手勢大師！';
  else if (finalScore >= 130) comment = '⭐ 表現優秀！非常厲害！';
  else if (finalScore >= 70)  comment = '👍 不錯喔！繼續練習吧！';
  else                         comment = '💪 多練習幾次，你一定行的！';

  fill(C.TEXT);
  textSize(16);
  textAlign(CENTER, TOP);
  text(comment, cx, detY + 30);

  // ── 操作按鈕 ────────────────────────────────────────────
  const btnW = min(PANEL_W - 60, 280);
  const btnX = cx - btnW / 2;
  const btn1Y = detY + 74;
  const btn2Y = btn1Y + 68;

  // [再玩一次]
  const hover1 = confirmedGesture.gesture === 'TWO';
  fill(hover1 ? C.SUCCESS : C.CARD);
  stroke(C.SUCCESS);
  strokeWeight(1.5);
  rect(btnX, btn1Y, btnW, 56, 10);
  noStroke();

  fill(hover1 ? C.BG : C.SUCCESS);
  textSize(18);
  textStyle(BOLD);
  textAlign(CENTER, CENTER);
  text('✌️  比 2 — 再玩一次', cx, btn1Y + 28);
  textStyle(NORMAL);

  // [返回首頁]
  const hover2 = confirmedGesture.gesture === 'OK';
  fill(hover2 ? C.PRIMARY : C.CARD);
  stroke(C.PRIMARY);
  strokeWeight(1.5);
  rect(btnX, btn2Y, btnW, 56, 10);
  noStroke();

  fill(hover2 ? C.BG : C.PRIMARY);
  textSize(18);
  textStyle(BOLD);
  textAlign(CENTER, CENTER);
  text('👌  OK — 返回首頁', cx, btn2Y + 28);
  textStyle(NORMAL);
}

/**
 * 繪製單個統計卡片
 */
function _drawStatCard(x, y, w, h, label, value, accentColor) {
  fill(C.CARD);
  noStroke();
  rect(x, y, w, h, 8);

  fill(C.MUTED);
  textSize(12);
  textAlign(CENTER, TOP);
  text(label, x + w / 2, y + 10);

  fill(accentColor);
  textSize(30);
  textStyle(BOLD);
  textAlign(CENTER, CENTER);
  text(value, x + w / 2, y + h / 2 + 8);
  textStyle(NORMAL);
}

// ══════════════════════════════════════════════════════════════
//   繪製：CONFIRM 確認彈窗
// ══════════════════════════════════════════════════════════════

/**
 * 確認彈窗：進入目標模式前讓玩家確認
 * 👌 OK = 確認進入   ✊ 握拳 = 取消
 */
function _drawConfirm() {
  const cx = PANEL_X + PANEL_W / 2;
  const panelTop = PANEL_Y;
  const panelBot = height - BOTTOM_H;
  const cy = panelTop + (panelBot - panelTop) / 2;

  const modeLabel = { LEARN: '學習模式', GAME: '遊戲模式' };
  const modeEmoji = { LEARN: '📚', GAME: '🎮' };
  const modeNote  = {
    LEARN: '依序練習所有手勢，有即時辨識回饋',
    GAME:  '90 秒倒計時答題挑戰，答對得分',
  };
  const warningText = (confirmFrom === 'LEARN' && confirmMode === 'GAME')
    ? '⚠️ 將中止目前的學習進度'
    : modeNote[confirmMode] || '';

  const mw = min(PANEL_W - 40, 340);
  const mh = 226;
  const mx = cx - mw / 2;
  const my = cy - mh / 2;

  // 半透明遮罩覆蓋右側面板
  fill(0, 0, 0, 100);
  noStroke();
  rect(PANEL_X, panelTop, PANEL_W, panelBot - panelTop);

  // 彈窗本體
  fill(C.PANEL);
  stroke(C.PRIMARY);
  strokeWeight(2);
  rect(mx, my, mw, mh, 14);
  noStroke();

  // 頂部彩條
  fill(confirmMode === 'GAME' ? C.SUCCESS : C.PRIMARY);
  rect(mx, my, mw, 5, 14, 14, 0, 0);

  // 標題
  fill(C.TEXT);
  textSize(21);
  textStyle(BOLD);
  textAlign(CENTER, TOP);
  text(`${modeEmoji[confirmMode] || ''}  進入${modeLabel[confirmMode]}？`, cx, my + 20);
  textStyle(NORMAL);

  // 說明文字
  fill(confirmFrom === 'LEARN' && confirmMode === 'GAME' ? C.WARNING : C.MUTED);
  textSize(12);
  text(warningText, cx, my + 58);

  // ── 兩個操作按鈕 ────────────────────────────────────
  const btnW = floor((mw - 36) / 2);
  const btnH = 62;
  const btnY = my + 88;

  // 左：確認（OK）
  const okActive = confirmedGesture.gesture === 'OK';
  fill(okActive ? C.SUCCESS : C.CARD);
  stroke(C.SUCCESS); strokeWeight(1.5);
  rect(mx + 12, btnY, btnW, btnH, 8);
  noStroke();

  textAlign(CENTER, TOP);
  fill(okActive ? C.BG : C.TEXT);
  textSize(24); text('👌', mx + 12 + btnW / 2, btnY + 8);
  textSize(14); textStyle(BOLD);
  text('OK  確認', mx + 12 + btnW / 2, btnY + 38);
  textStyle(NORMAL);
  fill(okActive ? C.BG : C.MUTED);
  textSize(11); text('比 OK 進入', mx + 12 + btnW / 2, btnY + btnH - 12);

  // 右：取消（FIST）
  const fistActive = confirmedGesture.gesture === 'FIST';
  fill(fistActive ? '#7C1D1D' : C.CARD);
  stroke(C.DANGER); strokeWeight(1.5);
  rect(mx + 24 + btnW, btnY, btnW, btnH, 8);
  noStroke();

  fill(fistActive ? C.TEXT : C.TEXT);
  textSize(24); text('✊', mx + 24 + btnW + btnW / 2, btnY + 8);
  textSize(14); textStyle(BOLD);
  fill(fistActive ? '#FCA5A5' : C.DANGER);
  text('握拳  取消', mx + 24 + btnW + btnW / 2, btnY + 38);
  textStyle(NORMAL);
  fill(C.MUTED);
  textSize(11); text('握拳返回', mx + 24 + btnW + btnW / 2, btnY + btnH - 12);

  // 底部提示
  fill(C.MUTED);
  textSize(11);
  textAlign(CENTER, BOTTOM);
  text('保持手勢約 1 秒即可確認', cx, my + mh - 8);
}

// ══════════════════════════════════════════════════════════════
//   遊戲邏輯更新（每幀執行）
// ══════════════════════════════════════════════════════════════

function _updateGameLogic() {
  const now = millis();

  // ── LEARN：成功延遲計時 ──────────────────────────────────
  if (gameState === 'LEARN' && learnSuccessTimer > 0) {
    if (now - learnSuccessTimer > LEARN_SUCCESS_DELAY) {
      learnIdx++;
      if (learnIdx >= LEARN_SEQUENCE.length) {
        // 全部學完 → 進入遊戲
        _enterGame();
      } else {
        learnSuccessTimer = 0;
        classifier.reset();
      }
    }
  }

  // ── GAME：倒計時 ────────────────────────────────────────
  if (gameState === 'GAME') {
    timeLeft = max(0, timeLeft - (1 / frameRate()));

    // 時間到 → 進入結算
    if (timeLeft <= 0) {
      _enterResult();
      return;
    }

    // 清除答對回饋動畫（並自動換題）
    if (correctFeedback && now - correctFeedbackTimer > CORRECT_DURATION) {
      correctFeedback = false;
      _pickNewTarget(); // 換下一道題
    }

    // 清除答錯回饋動畫
    if (wrongFeedback && now - wrongFeedbackTimer > WRONG_DURATION) {
      wrongFeedback = false;
    }
  }
}

// ══════════════════════════════════════════════════════════════
//   手勢輸入處理（觸發遊戲動作）
// ══════════════════════════════════════════════════════════════

function _handleGestureInput() {
  const now     = millis();
  const gesture = confirmedGesture.gesture;

  // 冷卻時間內不處理
  if (now - lastActionTime < ACTION_COOLDOWN) return;
  // 未辨識到手勢不處理
  if (gesture === 'UNKNOWN') return;

  let acted = false;

  // ── IDLE 狀態 ─────────────────────────────────────────
  if (gameState === 'IDLE') {
    if (gesture === 'ONE') {
      _enterConfirm('LEARN', 'IDLE');
      acted = true;
    } else if (gesture === 'TWO') {
      _enterConfirm('GAME', 'IDLE');
      acted = true;
    }
  }

  // ── CONFIRM 確認彈窗 ──────────────────────────────────
  else if (gameState === 'CONFIRM') {
    if (gesture === 'OK') {
      // 確認：前往目標模式
      if (confirmMode === 'LEARN') _enterLearn();
      else if (confirmMode === 'GAME') _enterGame();
      acted = true;
    } else if (gesture === 'FIST') {
      // 取消：回到來源狀態
      gameState = confirmFrom;
      classifier.reset();
      acted = true;
    }
  }

  // ── LEARN 狀態 ────────────────────────────────────────
  else if (gameState === 'LEARN') {
    // 比 2 → 先確認再跳到遊戲
    if (gesture === 'TWO') {
      _enterConfirm('GAME', 'LEARN');
      acted = true;
    }
    // 比出目標手勢（且尚未在成功等待中）
    else if (learnSuccessTimer === 0 && gesture === LEARN_SEQUENCE[learnIdx]) {
      learnSuccessTimer = now;
      acted = true;
    }
  }

  // ── GAME 狀態 ─────────────────────────────────────────
  else if (gameState === 'GAME') {
    if (correctFeedback || wrongFeedback) return;
    if (gesture === currentTarget) {
      _handleCorrect();
      acted = true;
    } else {
      _handleWrong(gesture);
      acted = true;
    }
  }

  // ── RESULT 狀態 ───────────────────────────────────────
  else if (gameState === 'RESULT') {
    if (gesture === 'TWO') {
      _enterConfirm('GAME', 'RESULT');
      acted = true;
    } else if (gesture === 'OK') {
      _enterIdle();
      acted = true;
    }
  }

  // 動作觸發後：更新冷卻時間並重置分類器
  if (acted) {
    lastActionTime = now;
    classifier.reset(); // 防止同一手勢連續觸發
  }
}

// ══════════════════════════════════════════════════════════════
//   遊戲答題邏輯
// ══════════════════════════════════════════════════════════════

/** 答對處理 */
function _handleCorrect() {
  correctCount++;
  totalAttempts++;
  combo++;
  maxCombo = max(maxCombo, combo);

  // 計算得分（連擊加成）
  let pts = 10;
  if (combo >= 5) pts += 10; // 大連擊
  else if (combo >= 3) pts += 5; // 中連擊
  score += pts;

  // 觸發視覺回饋
  correctFeedback      = true;
  correctFeedbackTimer = millis();
  // 注意：換題在 _updateGameLogic 中於 CORRECT_DURATION 後執行
}

/** 答錯處理 */
function _handleWrong(wrongGesture) {
  totalAttempts++;
  combo = 0;            // 連擊歸零
  wrongGuessName = wrongGesture;

  // 觸發視覺回饋
  wrongFeedback      = true;
  wrongFeedbackTimer = millis();
}

/** 隨機選擇下一道題，並從題庫抽取對應的教育問題 */
function _pickNewTarget() {
  let newTarget;
  let tries = 0;
  do {
    newTarget = GAME_POOL[floor(random(GAME_POOL.length))];
    tries++;
  } while (newTarget === currentTarget && tries < 15);
  currentTarget = newTarget;

  // 從該手勢的題庫中隨機選一題
  const g = GESTURES[currentTarget];
  if (g && g.questions && g.questions.length > 0) {
    const qIdx = floor(random(g.questions.length));
    currentQuestion = g.questions[qIdx];
    console.log(`📝 題目：${currentQuestion.text} → ${g.label}`);
  } else {
    // 若 gestures.js 沒有 questions（舊版檔案），用預設文字
    currentQuestion = { text: `請做出手勢：${g ? g.label : '?'}`, note: g ? g.instruction : '' };
    console.warn('⚠️ 此手勢沒有 questions 題庫，請確認 gestures.js 已更新至最新版本');
  }
}

// ══════════════════════════════════════════════════════════════
//   狀態轉換函式
// ══════════════════════════════════════════════════════════════

function _enterIdle() {
  gameState = 'IDLE';
  classifier.reset();
  console.log('→ IDLE');
}

function _enterConfirm(mode, from) {
  confirmMode = mode;
  confirmFrom = from;
  gameState = 'CONFIRM';
  classifier.reset();
  console.log(`→ CONFIRM (${mode})`);
}

function _enterLearn() {
  gameState         = 'LEARN';
  learnIdx          = 0;
  learnSuccessTimer = 0;
  classifier.reset();
  console.log('→ LEARN');
}

function _enterGame() {
  gameState       = 'GAME';
  score           = 0;
  timeLeft        = 90;
  combo           = 0;
  maxCombo        = 0;
  correctCount    = 0;
  totalAttempts   = 0;
  correctFeedback = false;
  wrongFeedback   = false;
  classifier.reset();
  _pickNewTarget();
  console.log('→ GAME');
}

function _enterResult() {
  gameState     = 'RESULT';
  finalScore    = score;
  finalCorrect  = correctCount;
  finalTotal    = totalAttempts;
  finalMaxCombo = maxCombo;
  finalAccuracy = totalAttempts > 0 ? floor((correctCount / totalAttempts) * 100) : 0;
  classifier.reset();
  console.log(`→ RESULT | 分數：${finalScore} | 正確率：${finalAccuracy}%`);
}

// ══════════════════════════════════════════════════════════════
//   工具函式（Utilities）
// ══════════════════════════════════════════════════════════════

/**
 * 解析十六進位色碼，回傳 [r, g, b] 整數陣列
 * 例：'#22C55E' → [34, 197, 94]
 */
function _parseHex(hex) {
  const clean = hex.replace('#', '');
  return [
    parseInt(clean.substring(0, 2), 16),
    parseInt(clean.substring(2, 4), 16),
    parseInt(clean.substring(4, 6), 16),
  ];
}

/**
 * 將十六進位色碼轉成帶 Alpha 的 p5 color 物件
 * @param {string} hex  - '#RRGGBB'
 * @param {number} alpha - 0~255
 */
function _hexWithAlpha(hex, alpha) {
  const [r, g, b] = _parseHex(hex);
  return color(r, g, b, alpha);
}
