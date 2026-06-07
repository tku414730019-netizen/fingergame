/**
 * gestures.js
 * ─────────────────────────────────────────────────────────────
 * 手勢定義，以及遊戲中每個手勢對應的教育題目。
 *
 * 每題格式：
 *   { text: '問題文字', note: '說明/提示（可選）' }
 *
 * 設計邏輯：
 *   ONE / TWO / THREE / OPEN_PALM → 數學或常識，答案是數字
 *   FIST         → 答案是 0（握緊 = 零根手指）
 *   OK           → 手勢意義問題
 *   THUMBS_UP    → 手勢意義問題
 */

const GESTURES = {

  UNKNOWN: {
    name: 'UNKNOWN', label: '未辨識',
    instruction: '請將手放入鏡頭範圍內',
    emoji: '❓', color: '#64748B',
    questions: [],
  },

  // ── FIST  = 0 根手指 ──────────────────────────────────────
  FIST: {
    name: 'FIST', label: '握拳',
    instruction: '五根手指全部向掌心握緊',
    emoji: '👊', color: '#A855F7',
    questions: [
      { text: '3 − 3 = ?',      note: '答案是零，握緊拳頭不伸出手指' },
      { text: '0 × 99 = ?',     note: '任何數乘以零都等於零' },
      { text: '5 − 4 − 1 = ?',  note: '一步一步算' },
    ],
  },

  // ── ONE  = 1 根手指 ───────────────────────────────────────
  ONE: {
    name: 'ONE', label: '比 1',
    instruction: '伸直食指，其他四指握緊',
    emoji: '☝️', color: '#3B82F6',
    questions: [
      { text: '地球有幾個月亮？',     note: '月球是地球唯一的天然衛星' },
      { text: '2 − 1 = ?',          note: null },
      { text: '一個三角形有幾種邊長形狀？（等邊）', note: '等邊三角形三邊等長，視為一種' },
      { text: '一週有幾個星期一？',   note: null },
    ],
  },

  // ── TWO  = 2 根手指 ───────────────────────────────────────
  TWO: {
    name: 'TWO', label: '比 2',
    instruction: '伸直食指與中指，做出剪刀手',
    emoji: '✌️', color: '#2563EB',
    questions: [
      { text: '人有幾隻眼睛？',       note: null },
      { text: '1 + 1 = ?',           note: null },
      { text: '剪刀石頭布，剪刀伸出幾根手指？', note: '伸出食指和中指' },
      { text: '一對筷子有幾根？',     note: null },
    ],
  },

  // ── THREE  = 3 根手指 ─────────────────────────────────────
  THREE: {
    name: 'THREE', label: '比 3',
    instruction: '伸直食指、中指、無名指，小指與拇指握住',
    emoji: '🤟', color: '#0EA5E9',
    questions: [
      { text: '三角形有幾個角？',     note: null },
      { text: '1 + 2 = ?',           note: null },
      { text: '交通號誌有幾種顏色？', note: '紅、黃、綠' },
      { text: '石頭剪刀布有幾種出法？', note: '石頭、剪刀、布' },
    ],
  },

  // ── OPEN_PALM  = 5 根手指 ─────────────────────────────────
  OPEN_PALM: {
    name: 'OPEN_PALM', label: '張開手掌',
    instruction: '五根手指全部伸直張開，掌心朝向鏡頭',
    emoji: '🖐️', color: '#06B6D4',
    questions: [
      { text: '一隻手有幾根手指？',   note: null },
      { text: '2 + 3 = ?',           note: null },
      { text: '一週有幾個工作日？',   note: '星期一到星期五' },
      { text: '五邊形有幾個頂點？',   note: null },
    ],
  },

  // ── OK  ───────────────────────────────────────────────────
  OK: {
    name: 'OK', label: 'OK 手勢',
    instruction: '拇指與食指圍成圓形，中指、無名指、小指伸直',
    emoji: '👌', color: '#22C55E',
    questions: [
      { text: '潛水員表示「安全沒問題」用什麼手勢？', note: '拇指食指圈成圓形' },
      { text: '👌 這個 Emoji 代表什麼手勢？',         note: null },
      { text: '比出表示「好的、可以」的手勢',          note: 'OK 手勢，源自英文 Okay' },
    ],
  },

  // ── THUMBS_UP  ────────────────────────────────────────────
  THUMBS_UP: {
    name: 'THUMBS_UP', label: '比讚',
    instruction: '握拳，並將拇指向上豎起',
    emoji: '👍', color: '#F59E0B',
    questions: [
      { text: '社群媒體「按讚」的手勢是？', note: '表示喜歡、支持' },
      { text: '👍 這個 Emoji 代表什麼手勢？', note: null },
      { text: '比出表示「太棒了！鼓勵你！」的手勢', note: '豎起大拇指' },
    ],
  },
};

// ── 學習模式順序（由簡單到複雜）──────────────────────────────
const LEARN_SEQUENCE = [
  'FIST', 'ONE', 'TWO', 'THREE', 'OPEN_PALM', 'OK', 'THUMBS_UP',
];

// ── 遊戲模式手勢池 ────────────────────────────────────────────
const GAME_POOL = [
  'FIST', 'ONE', 'TWO', 'THREE', 'OPEN_PALM', 'OK', 'THUMBS_UP',
];
