/**
 * GestureClassifier.js
 * ─────────────────────────────────────────────────────────────
 * 手勢辨識核心類別。
 *
 * 輸入：ml5.js Handpose 提供的 21 個關鍵點 (landmarks)
 * 輸出：{ gesture, confidence, tips }
 *
 * 內建「防抖動」機制：
 *   連續 8 幀辨識出相同手勢，才更新「已確認手勢」，
 *   避免手部晃動造成誤觸發。
 *
 * ── MediaPipe Hand Landmark 索引對照 ──
 *
 *   0:  wrist（手腕）
 *   1:  thumb_cmc   2: thumb_mcp   3: thumb_ip    4: thumb_tip
 *   5:  index_mcp   6: index_pip   7: index_dip   8: index_tip
 *   9:  middle_mcp  10: middle_pip 11: middle_dip 12: middle_tip
 *   13: ring_mcp    14: ring_pip   15: ring_dip   16: ring_tip
 *   17: pinky_mcp   18: pinky_pip  19: pinky_dip  20: pinky_tip
 *
 * ── 指節縮寫說明 ──
 *   MCP = Metacarpophalangeal Joint（掌指關節，手指根部）
 *   PIP = Proximal Interphalangeal Joint（近端指間關節，中間）
 *   DIP = Distal Interphalangeal Joint（遠端指間關節）
 *   TIP = 指尖
 */

class GestureClassifier {

  /**
   * 建構子：初始化防抖動緩衝區
   */
  constructor() {
    // 緩衝區：儲存最近 N 幀的辨識結果
    this.frameBuffer  = [];
    this.bufferSize   = 8;    // ← 可調整：數字越大越穩定，但延遲越高

    // 已確認的穩定手勢（8 幀一致後才更新）
    this.confirmedResult = {
      gesture:    'UNKNOWN',
      confidence: 0,
      tips:       [],
    };

    // 即時辨識（每幀更新，用於顯示信心值進度條）
    this.instantResult = {
      gesture:    'UNKNOWN',
      confidence: 0,
      tips:       [],
    };
  }

  // ════════════════════════════════════════════════════════════
  //   公開方法（Public API）
  // ════════════════════════════════════════════════════════════

  /**
   * 主要辨識方法
   *
   * @param {Object} hand - ml5 handpose 的單手預測物件
   *   手的結構：{ landmarks: [[x,y,z], ...21 個點... ] }
   * @returns {{ gesture: string, confidence: number, tips: string[] }}
   *   gesture    - 手勢名稱（對應 gestures.js 中的 key）
   *   confidence - 辨識信心值 0.0 ~ 1.0
   *   tips       - 改善建議文字（可能是空陣列）
   */
  classifyGesture(hand) {
    // 防禦性檢查：確保有效的手部資料
    if (!hand || !hand.landmarks || hand.landmarks.length < 21) {
      this._clearBuffer();
      return { gesture: 'UNKNOWN', confidence: 0, tips: ['請將手放入鏡頭'] };
    }

    const lm = hand.landmarks;

    // 進行即時辨識
    const result          = this._detectGesture(lm);
    this.instantResult    = result;

    // 防抖動：將結果加入緩衝區
    this.frameBuffer.push(result.gesture);
    if (this.frameBuffer.length > this.bufferSize) {
      this.frameBuffer.shift(); // 移除最舊的紀錄
    }

    // 檢查緩衝區是否全部一致
    if (this.frameBuffer.length >= this.bufferSize) {
      const first  = this.frameBuffer[0];
      const allSame = this.frameBuffer.every(g => g === first);

      if (allSame && first !== 'UNKNOWN') {
        this.confirmedResult = result; // 更新確認手勢
      } else if (allSame && first === 'UNKNOWN') {
        // 手部消失
        this.confirmedResult = { gesture: 'UNKNOWN', confidence: 0, tips: [] };
      }
    }

    return result;
  }

  /**
   * 取得「已確認」的穩定手勢（8 幀一致後才觸發動作）
   */
  getConfirmed() {
    return this.confirmedResult;
  }

  /**
   * 取得「即時」辨識結果（每幀更新，用於 UI 顯示）
   */
  getInstant() {
    return this.instantResult;
  }

  /**
   * 重置分類器
   * 在遊戲邏輯觸發動作後呼叫，防止同一個手勢連續觸發多次。
   */
  reset() {
    this._clearBuffer();
    this.confirmedResult = { gesture: 'UNKNOWN', confidence: 0, tips: [] };
    this.instantResult   = { gesture: 'UNKNOWN', confidence: 0, tips: [] };
  }

  // ════════════════════════════════════════════════════════════
  //   私有方法（Internal Helpers）
  // ════════════════════════════════════════════════════════════

  /** 清空緩衝區 */
  _clearBuffer() {
    this.frameBuffer = [];
  }

  /**
   * 從 landmark 陣列取出第 i 個點的 {x, y, z}
   * 相容兩種格式：
   *   - 陣列格式 [x, y, z]（ml5 0.12.x 常見）
   *   - 物件格式 {x, y, z}（部分版本使用）
   */
  _pt(lm, i) {
    const p = lm[i];
    if (Array.isArray(p)) {
      return { x: p[0], y: p[1], z: p[2] || 0 };
    }
    return { x: p.x, y: p.y, z: p.z || 0 };
  }

  /** 計算兩點間的 2D 歐氏距離 */
  _dist(a, b) {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
  }

  /**
   * 判斷手指是否「伸直」
   *
   * 原理：
   *   在螢幕座標系中，y 向下遞增（0 = 頂部）。
   *   當手垂直持握時，伸直的手指：指尖 y < 掌指關節 y。
   *   判斷標準：指尖到 MCP 的垂直延伸距離 > 手指全長的 30%。
   *
   * @param {Array} lm       - landmarks 陣列
   * @param {number} tipIdx  - 指尖索引（如 index tip = 8）
   * @param {number} pipIdx  - PIP 關節索引（如 index pip = 6）
   * @param {number} mcpIdx  - MCP 關節索引（如 index mcp = 5）
   * @returns {boolean}
   */
  _isFingerStraight(lm, tipIdx, pipIdx, mcpIdx) {
    const tip = this._pt(lm, tipIdx);
    const mcp = this._pt(lm, mcpIdx);

    const fingerLen = this._dist(tip, mcp);       // 指尖到根部的距離
    const extentY   = mcp.y - tip.y;              // 垂直延伸量（正值 = 向上）

    // ← 可調整此閾值：值越大，要求手指越直才算「伸直」
    return extentY > fingerLen * 0.35;
  }

  /** 判斷手指是否「彎曲」（isFingerStraight 的反向） */
  _isFingerCurled(lm, tipIdx, pipIdx, mcpIdx) {
    return !this._isFingerStraight(lm, tipIdx, pipIdx, mcpIdx);
  }

  // ════════════════════════════════════════════════════════════
  //   核心辨識邏輯
  // ════════════════════════════════════════════════════════════

  /**
   * 對 21 個關鍵點進行手勢辨識
   *
   * 判斷順序：
   *   OK（特殊距離判斷）
   *   → THUMBS_UP（拇指向上 + 四指握緊）
   *   → FIST（四指全握）
   *   → OPEN_PALM（四指全開）
   *   → ONE / TWO / THREE（伸直手指數量）
   *   → UNKNOWN
   *
   * @param {Array} lm - 21 個關鍵點
   * @returns {{ gesture, confidence, tips }}
   */
  _detectGesture(lm) {
    const pt = (i) => this._pt(lm, i);

    // ── 計算各手指的伸直/彎曲狀態 ──────────────────────────────
    //   參數：(lm, 指尖索引, PIP索引, MCP索引)
    const indexStr  = this._isFingerStraight(lm,  8,  6,  5); // 食指
    const middleStr = this._isFingerStraight(lm, 12, 10,  9); // 中指
    const ringStr   = this._isFingerStraight(lm, 16, 14, 13); // 無名指
    const pinkyStr  = this._isFingerStraight(lm, 20, 18, 17); // 小指

    // ── 拇指特殊處理 ────────────────────────────────────────────
    // 拇指向側邊伸展，用「指尖到手腕距離 vs IP到手腕距離」判斷
    const wrist     = pt(0);
    const thumbTip  = pt(4); // 拇指指尖
    const thumbIp   = pt(3); // 拇指 IP 關節
    const thumbMcp  = pt(2); // 拇指 MCP 關節
    const thumbStr  = this._dist(thumbTip, wrist) > this._dist(thumbIp, wrist) * 1.2;

    // ── 手掌尺寸（作為距離判斷的基準）───────────────────────────
    // 使用「手腕到中指MCP」距離作為手掌大小的參考
    const handSize = this._dist(wrist, pt(9));

    // 提示訊息陣列（會在 UNKNOWN 或接近成功時填入建議）
    const tips = [];

    // ════════════════════════════════════════════════════════
    //   1. OK 手勢偵測（拇指 + 食指指尖靠近）
    // ════════════════════════════════════════════════════════
    const indexTip        = pt(8);
    const thumbIndexDist  = this._dist(thumbTip, indexTip);
    const okRatio         = handSize > 0 ? thumbIndexDist / handSize : 99;

    // 判斷條件：
    //   - 拇指食指距離 / 手掌大小 < 0.45（靠近）
    //   - 中指、無名指、小指伸直
    if (okRatio < 0.45 && middleStr && ringStr && pinkyStr) {
      if (!middleStr) tips.push('中指可再伸直');
      if (!ringStr)   tips.push('無名指可再伸直');
      return { gesture: 'OK', confidence: 0.88, tips };
    }

    // ════════════════════════════════════════════════════════
    //   2. THUMBS_UP 偵測（拇指向上豎起，四指握緊）
    // ════════════════════════════════════════════════════════
    //   判斷條件：
    //   - 拇指指尖的 y 座標 明顯低於拇指 MCP（在螢幕上更高）
    //   - 四指全部彎曲
    const thumbPointingUp = thumbTip.y < thumbMcp.y - (handSize * 0.25);

    if (thumbPointingUp && !indexStr && !middleStr && !ringStr && !pinkyStr) {
      if (!thumbPointingUp) tips.push('拇指可以更向上');
      return { gesture: 'THUMBS_UP', confidence: 0.87, tips };
    }

    // ════════════════════════════════════════════════════════
    //   3. FIST 偵測（四指全部彎曲）
    // ════════════════════════════════════════════════════════
    if (!indexStr && !middleStr && !ringStr && !pinkyStr) {
      return { gesture: 'FIST', confidence: 0.90, tips: [] };
    }

    // ════════════════════════════════════════════════════════
    //   4. OPEN_PALM 偵測（四指全部伸直）
    // ════════════════════════════════════════════════════════
    if (indexStr && middleStr && ringStr && pinkyStr) {
      return { gesture: 'OPEN_PALM', confidence: 0.90, tips: [] };
    }

    // ════════════════════════════════════════════════════════
    //   5. ONE 偵測（只有食指伸直）
    // ════════════════════════════════════════════════════════
    if (indexStr && !middleStr && !ringStr && !pinkyStr) {
      if (!indexStr) tips.push('食指可再伸直');
      return { gesture: 'ONE', confidence: 0.87, tips };
    }

    // ════════════════════════════════════════════════════════
    //   6. TWO 偵測（食指 + 中指伸直）
    // ════════════════════════════════════════════════════════
    if (indexStr && middleStr && !ringStr && !pinkyStr) {
      if (!indexStr)  tips.push('食指可再伸直');
      if (!middleStr) tips.push('中指可再伸直');
      return { gesture: 'TWO', confidence: 0.88, tips };
    }

    // ════════════════════════════════════════════════════════
    //   7. THREE 偵測（食指 + 中指 + 無名指伸直）
    // ════════════════════════════════════════════════════════
    if (indexStr && middleStr && ringStr && !pinkyStr) {
      return { gesture: 'THREE', confidence: 0.85, tips: [] };
    }

    // ════════════════════════════════════════════════════════
    //   8. 未辨識（UNKNOWN）
    // ════════════════════════════════════════════════════════
    const straightCount = [indexStr, middleStr, ringStr, pinkyStr].filter(Boolean).length;

    if (straightCount === 0) {
      tips.push('試試伸直幾根手指');
    } else if (straightCount >= 1) {
      tips.push(`偵測到 ${straightCount} 根手指伸直，繼續嘗試`);
    }

    return { gesture: 'UNKNOWN', confidence: 0, tips };
  }
}
