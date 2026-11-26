// 🔒 השרת של ה-AI: כל בקשה ל-Gemini עוברת כאן. השרת בודק מי שואל וכמה הוא כבר שאל היום,
// ורק אז שולח ל-Gemini. לתלמיד אין דרך לשנות את המונה כאן – הוא נשמר ב-aiQuota/{uid},
// ולכללים של Firestore אין שום הרשאה לשם (רק השרת יכול לכתוב).
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const crypto = require('crypto');

initializeApp();
const db = getFirestore();
const GEMINI_KEY = defineSecret('GEMINI_API_KEY');

// כמה בקריאות ל-AI מותר ביום לכל סוג. זה קצת יותר מהמכסה שרואים באתר,
// כי פעולה אחת לפעמים צריכה כמה קריאות (ניסיון חוזר, בדיקה כפולה של תמונה).
const LIMIT = { chat: 32, sum: 6, qa: 8, pr: 8, fc: 8, ocr: 14, imp: 30, img: 4 };
// יצירת תמונות: מנסים לפי הסדר עד שאחד עובד (שמות של מודלים משתנים מדי פעם)
const IMAGE_MODELS = ['gemini-2.5-flash-image', 'gemini-3.1-flash-image-preview', 'gemini-2.0-flash-preview-image-generation'];
const PER_MINUTE = 10;              // לכל משתמש, כל הסוגים יחד
// כל האתר יחד: ל-Gemini החינמי יש 15 בקשות בדקה לכל הפרויקט. שומרים מקום אחד ביטחון.
// בקשה שאין לה מקום בדקה הזו מחכה (תור) עד הדקה הבאה, ולא נכשלת מיד.
// תקרה יומית לכל האתר יחד: מעליה ה-AI לא עונה עד חצות (בעל האתר לא מוגבל). שומרת שהעלות לא תעבור סכום קבוע
const SITE_DAY_CAP = +process.env.AI_SITE_DAY_CAP || 500;
const GLOBAL_PER_MIN = +process.env.AI_GLOBAL_PER_MIN || 14, QUEUE_WAIT_MS = +process.env.AI_QUEUE_WAIT_MS || 25000;
const MODELS = ['gemini-3.5-flash-lite'];
const ALT_LITE = ['gemini-3.1-flash-lite', 'gemini-3.1-flash-lite'];   // (24.11.2026: gemini-flash-lite-latest מחזיר 404)
const DOWN = { HIGH: 'MEDIUM', MEDIUM: 'LOW', LOW: 'LOW', MINIMAL: 'MINIMAL' };   // גיבוי כשהמודל הרגיל עמוס (503) – שרת אחר אצל גוגל, מכסה נפרדת               // המודל של כולם (גם של בעל האתר)
// תמונה לטקסט (מצב "מדויק"): המודל החזק קורא כתב יד הרבה יותר טוב. ל-Flash יש מכסה קטנה (20 ביום לכל הפרויקט),
// אז סופרים כאן, ואחרי OCR_FLASH_DAY ביום – או אם Gemini אומר שנגמר – עוברים לבד ל-Lite
// Flash גם לשאלות קשות (עוזר, שאלונים, תרגול, סיכום) – כל עוד נשארה מכסה חינמית היום. משאירים ל-OCR לפחות 6 ביום
const FLASH_KINDS = ['chat', 'qa', 'pr', 'sum'], FLASH_SMART_DAY = 12, FLASH_SMART_USER = 3;
let flashDead = -1;   // היום (israelDay) שבו Flash כבר החזיר 429 – לא מנסים שוב עד מחר
const OCR_MODEL = 'gemini-3.5-flash', OCR_FLASH_DAY = +process.env.AI_OCR_FLASH_DAY || 18, OCR_FLASH_USER = +process.env.AI_OCR_FLASH_USER || 2;   // לכל האתר / לכל משתמש ביום
const MAX_BYTES = 24 * 1024 * 1024, MAX_PARTS = 40;
// בעל האתר – בלי הגבלה. כמו באתר: SHA-256 של 'my-notebooks:' + האימייל, כדי שהאימייל לא יופיע בקוד
const UNLIMITED_HASH = ['d480d79943873e56d1e096093086e83c75764b6af1c3d65cd0900a876e2bd622'];
// שגריר (הביא 10 חברים או יותר, refs/{uid}/joined): כל המכסות פי 2. נשמר בזיכרון ל-10 דקות כדי לא לספור בכל בקשה
const AMB_MIN = 10, AMB_X = 2, ambCache = new Map();
async function isAmb(uid) {
  const c = ambCache.get(uid); if (c && Date.now() - c.t < 600000) return c.v;
  let v = false;
  try { v = (await db.collection(`refs/${uid}/joined`).count().get()).data().count >= AMB_MIN; } catch (e) { console.warn('amb', String(e && e.message).slice(0, 80)); }
  ambCache.set(uid, { v, t: Date.now() }); return v;
}
// ===== רצף יומי (24.11.2026): נכנסים כל יום → פרס קטן כל יום, ופרס גדול ביום 7, 14 ו-30 (ואז מתחילים סבב חדש) =====
// רק השרת כותב ל-streaks/{uid}, כדי שאי אפשר לרמות מהדפדפן. אותה טבלה בדיוק יש באתר (STREAK_SMALL ב-app.js) – לשנות בשני המקומות
const STREAK_SMALL = [['chat', 3], ['ocr', 1], ['fc', 1], ['sum', 1], ['pr', 1], ['kit', 1], ['wr', 2]];
const STREAK_SERVER_KIND = { kit: 'chat', wr: 'chat', cf: 'chat' };   // סוגים שהשרת סופר תחת סוג אחר
const streakDayOf = n => ((n - 1) % 30) + 1;
const streakSmall = d => STREAK_SMALL[(d - 1) % STREAK_SMALL.length];
const streakCache = new Map();
async function streakBoost(uid) {
  const day = israelDay(), c = streakCache.get(uid);
  if (c && c.day === day && Date.now() - c.t < 600000) return c.v;
  let v = { add: {}, x2: false, flash: 0 };
  try {
    const sn = await db.doc(`streaks/${uid}`).get(); const s = sn.exists ? sn.data() : {};
    if (s.bonusDay === day && s.bonus && s.bonus.k) { const k = STREAK_SERVER_KIND[s.bonus.k] || s.bonus.k; v.add[k] = (+s.bonus.add || 0); }
    v.x2 = s.x2Day === day;
    v.flash = (s.flashUntil || 0) >= day ? 1 : 0;
  } catch (e) { console.warn('streak', String(e && e.message).slice(0, 80)); }
  streakCache.set(uid, { day, v, t: Date.now() }); return v;
}
// ===== גירים (24.11.2026): מטבע שמרוויחים באתר וקונים בו שימושים ב-AI ועיצובים. רק השרת כותב ל-wallet/{uid} =====
// מרוויחים: כניסה יומית (ברצף), צילום לוח, מחברת חדשה, חבר שהצטרף. לכל סוג יש תקרה יומית כדי שאי אפשר "לחרוש"
const EARN = { day: { a: 5, cap: 1 }, big: { a: 25, cap: 1 }, ocr: { a: 2, cap: 3 }, nb: { a: 5, cap: 2 }, friend: { a: 20, cap: 50 }, ask: { a: 1, cap: 1 }, quest: { a: 10, cap: 1 }, fc: { a: 2, cap: 1 }, sum: { a: 2, cap: 1 }, pr: { a: 2, cap: 1 } };
// משימות היום (24.11.2026): נכנסים (day) + מצלמים לוח (ocr) + שואלים את העוזר (ask) → בונוס quest. אותה רשימה באתר (QUESTS)
// (24.11.2026) המשימות מתחלפות כל יום: 'day' קבוע + זוג מהטבלה לפי היום (אותה טבלה באתר – QUEST_PAIRS)
const QUEST_PAIRS = [['ocr', 'fc'], ['ask', 'sum'], ['nb', 'ocr'], ['fc', 'ask'], ['sum', 'pr'], ['ocr', 'ask'], ['nb', 'fc'], ['pr', 'ask']];
const questKinds = day => ['day', ...QUEST_PAIRS[((day % QUEST_PAIRS.length) + QUEST_PAIRS.length) % QUEST_PAIRS.length]];
// החנות – אותה רשימה ב-app.js (SHOP). שימוש ב-AI שנקנה טוב רק לאותו יום
const SHOP = {
  // (26.11.2026) מחירים עלו – שיהיה בשביל מה לחסוך. אותם מחירים ב-app.js
  ocr1: { p: 15, k: 'ocr', add: 1, max: 3 }, sum1: { p: 15, k: 'sum', add: 1, max: 2 }, chat5: { p: 10, k: 'chat', add: 5, max: 3 },
  fc1: { p: 12, k: 'fc', add: 1, max: 2 }, kit1: { p: 12, k: 'kit', add: 1, max: 2 }, pr1: { p: 12, k: 'pr', add: 1, max: 2 },
  shield: { p: 40, shield: true },
  chalk: { p: 30, skin: true }, sunset: { p: 30, skin: true }, ocean: { p: 30, skin: true },
  // (24.11.2026) הפרסים של תוכנית החברים עברו לחנות – כל אחד יכול לקנות בגירים. מי שכבר קיבל אותם מחברים – שומר (באתר: legacyHas)
  spcolors: { p: 120, skin: true }, spbg: { p: 100, skin: true }, funfont: { p: 80, skin: true }, accent: { p: 150, skin: true }, frame: { p: 100, skin: true },
};
// מוסיף גירים בתוך טרנזקציה קיימת (או חדשה). מחזיר כמה באמת נוספו (0 אם עברנו את התקרה של היום)
function earnIn(tx, w, kind, n = 1) {
  const e = EARN[kind], day = israelDay();
  const de = w.day === day ? { ...(w.dayEarn || {}) } : {};
  const left = Math.max(0, e.cap - (de[kind] || 0)), times = Math.min(n, left);
  if (!times) return { w, got: 0 };
  de[kind] = (de[kind] || 0) + times;
  let got = e.a * times, log = [{ t: kind, a: got, at: Date.now() }, ...(w.log || [])];
  let qd = w.qd || [];
  if (kind !== 'quest' && !de.quest && questKinds(day).every(k => de[k])) { de.quest = 1; got += EARN.quest.a; log = [{ t: 'quest', a: EARN.quest.a, at: Date.now() + 1 }, ...log]; qd = [...qd.filter(x => x !== day), day].slice(-40); }   // qd = ימים שהושלמו (כוכב במסלול)   // כל משימות היום – בונוס
  log = log.slice(0, 20);
  return { w: { ...w, bal: (w.bal || 0) + got, total: (w.total || 0) + got, day, dayEarn: de, log, qd }, got };
}
// "כרטיס" שמחכה: ה-AI הכין משהו, והלומיקס יינתנו רק כשהמשתמש באמת משתמש בו (questDone)
const PEND_KINDS = ['ocr', 'fc', 'sum', 'pr'];
async function pendOne(uid, k) {
  const ref = db.doc(`wallet/${uid}`), day = israelDay();
  await db.runTransaction(async tx => { const sn = await tx.get(ref); const w = sn.exists ? sn.data() : {}; const p = w.pend && w.pend.day === day ? { ...w.pend } : { day }; p[k] = Math.min(3, (p[k] || 0) + 1); tx.set(ref, { pend: p }, { merge: true }); });
}
// חברים שהצטרפו לפני שהיו לומיקס (24.11.2026 18:40) – מקבלים עכשיו 20 לכל חבר (עד 10), פעם אחת (refBack)
const WALLET_START = Date.UTC(2026, 10, 24, 16, 40, 0);
async function refBackCount(uid) { try { return (await db.collection(`refs/${uid}/joined`).where('at', '<', WALLET_START).count().get()).data().count; } catch (e) { console.warn('refBack', String(e && e.message).slice(0, 80)); return -1; } }
function refBackIn(w, cnt) {
  if (w.refBack || cnt < 0) return { w, got: 0 };
  const got = EARN.friend.a * Math.min(cnt, 10);
  const out = { ...w, refBack: 1 };
  if (got) Object.assign(out, { bal: (w.bal || 0) + got, total: (w.total || 0) + got, log: [{ t: 'friendBack', a: got, at: Date.now() }, ...(w.log || [])].slice(0, 20) });
  return { w: out, got };
}
async function earn(uid, kind, n = 1) {
  const ref = db.doc(`wallet/${uid}`);
  try {
    return await db.runTransaction(async tx => {
      const sn = await tx.get(ref); const r = earnIn(tx, sn.exists ? sn.data() : {}, kind, n);
      if (r.got) tx.set(ref, r.w);
      return r.got;
    });
  } catch (e) { console.warn('earn', kind, String(e && e.message).slice(0, 80)); return 0; }
}
const walletCache = new Map();
async function walletExtra(uid) {
  const day = israelDay(), c = walletCache.get(uid);
  if (c && c.day === day && Date.now() - c.t < 120000) return c.v;
  let v = {};
  try { const sn = await db.doc(`wallet/${uid}`).get(); const w = sn.exists ? sn.data() : {}; if (w.extra && w.extra.day === day) for (const [k, n] of Object.entries(w.extra.add || {})) { const sk = STREAK_SERVER_KIND[k] || k; v[sk] = (v[sk] || 0) + (+n || 0); } } catch {}
  walletCache.set(uid, { day, v, t: Date.now() }); return v;
}
const israelDay = () => Math.floor((Date.now() + 10800000) / 864e5);

function isOwner(token) {
  if (!token || !token.email || token.email_verified !== true) return false;
  const h = crypto.createHash('sha256').update('my-notebooks:' + String(token.email).toLowerCase()).digest('hex');
  return UNLIMITED_HASH.includes(h);
}

function cleanParts(parts) {
  if (!Array.isArray(parts) || !parts.length || parts.length > MAX_PARTS) throw new HttpsError('invalid-argument', 'bad-parts');
  let bytes = 0;
  const out = parts.map(p => {
    if (p && typeof p.text === 'string') { bytes += p.text.length * 2; return { text: p.text }; }
    const d = p && p.inlineData;
    if (d && typeof d.data === 'string' && typeof d.mimeType === 'string' && /^(image\/[\w.+-]+|application\/pdf|text\/[\w.+-]+)$/.test(d.mimeType)) {
      bytes += d.data.length; return { inlineData: { mimeType: d.mimeType, data: d.data } };
    }
    throw new HttpsError('invalid-argument', 'bad-part');
  });
  if (bytes > MAX_BYTES) throw new HttpsError('invalid-argument', 'too-big');
  return out;
}

function cleanConfig(c) {
  const out = {};
  if (c && typeof c.temperature === 'number') out.temperature = Math.min(2, Math.max(0, c.temperature));
  if (c && (c.responseMimeType === 'application/json' || c.responseMimeType === 'text/plain')) out.responseMimeType = c.responseMimeType;
  // מודלים של Gemini 3 ומעלה עובדים עם thinkingLevel (ב-3.5 Flash-Lite ברירת המחדל היא minimal – כמעט בלי חשיבה).
  // אם האתר שלח רמה – משתמשים בה (אסור לשלוח את שניהם יחד), ואם לא – בתקציב הישן
  const tl = c && c.thinkingConfig && c.thinkingConfig.thinkingLevel;
  const tb = c && c.thinkingConfig && c.thinkingConfig.thinkingBudget;
  // (נבדק 24.11.2026: thinkingBudget מחזיר 400 ב-gemini-3.5 – אז תמיד רמה)
  const lv = ['minimal', 'low', 'medium', 'high'].includes(tl) ? tl : Number.isInteger(tb) ? (tb <= 0 ? 'minimal' : tb <= 512 ? 'low' : tb <= 1024 ? 'medium' : 'high') : '';
  if (lv) out.thinkingConfig = { thinkingLevel: lv.toUpperCase() };
  // רזולוציה של תמונות (לקריאת כתב יד ולוח – HIGH)
  if (c && ['MEDIA_RESOLUTION_LOW', 'MEDIA_RESOLUTION_MEDIUM', 'MEDIA_RESOLUTION_HIGH'].includes(c.mediaResolution)) out.mediaResolution = c.mediaResolution;
  return out;
}

async function takeGlobal(kind, owner) {
  const ref = db.doc('aiQuota/_site');
  const until = Date.now() + QUEUE_WAIT_MS;
  for (;;) {
    const min = Math.floor(Date.now() / 60000);
    const ok = await db.runTransaction(async tx => {
      const sn = await tx.get(ref); const g = sn.exists ? sn.data() : {};
      const count = g.min === min ? (g.count || 0) : 0;
      const day = israelDay(), same = g.day === day;
      if (!owner && same && (g.today || 0) >= SITE_DAY_CAP) return 'cap';
      if (count >= GLOBAL_PER_MIN) return false;
      // גם ספירה יומית של כל האתר (לפי סוג), בשביל העמוד "ניהול האתר"
      const kinds = same && g.kinds ? { ...g.kinds } : {}; kinds[kind] = (kinds[kind] || 0) + 1;
      tx.set(ref, { min, count: count + 1, day, today: (same ? g.today || 0 : 0) + 1, kinds, prevDay: same ? g.prevDay || null : (g.day ? { day: g.day, today: g.today || 0 } : null) }); return true;
    });
    if (ok === 'cap') throw new HttpsError('resource-exhausted', 'site-cap');
    if (ok) return;
    const wait = (min + 1) * 60000 - Date.now() + Math.random() * 1500;   // עד תחילת הדקה הבאה, בפיזור קטן
    if (Date.now() + wait > until) throw new HttpsError('resource-exhausted', 'site-busy');
    await new Promise(res => setTimeout(res, wait));
  }
}
// בקשה שנכשלה לפני שנשלחה תשובה – מחזירים את השימוש למכסה של המשתמש
async function refundOne(uid, kind) {
  const ref = db.doc(`aiQuota/${uid}`);
  try {
    await db.runTransaction(async tx => {
      const sn = await tx.get(ref); if (!sn.exists) return;
      const q = sn.data(); if (q.day !== israelDay()) return;
      const used = (q.counts && q.counts[kind]) || 0; if (used <= 0) return;
      tx.set(ref, { ...q, counts: { ...q.counts, [kind]: used - 1 }, minCount: Math.max(0, (q.minCount || 1) - 1) });
    });
  } catch (e) { console.warn('refund', String(e && e.message).slice(0, 120)); }
}
// סופרים קודם, ורק אז שואלים את Gemini. הכול בטרנזקציה, אז גם הרבה בקשות בבת אחת לא עוברות את המכסה.
async function takeOne(uid, kind) {
  const sb = await streakBoost(uid), wx = await walletExtra(uid);
  const max = (LIMIT[kind] + (sb.add[kind] || 0) + (wx[kind] || 0)) * (await isAmb(uid) ? AMB_X : 1) * (sb.x2 ? 2 : 1);
  const ref = db.doc(`aiQuota/${uid}`);
  await db.runTransaction(async tx => {
    const sn = await tx.get(ref);
    const day = israelDay(), min = Math.floor(Date.now() / 60000);
    let q = sn.exists ? sn.data() : {};
    if (q.day !== day) q = { day, counts: {} };
    const used = (q.counts && q.counts[kind]) || 0;
    if (used >= max) throw new HttpsError('resource-exhausted', 'daily-limit');
    const minCount = q.min === min ? (q.minCount || 0) : 0;
    if (minCount >= PER_MINUTE) throw new HttpsError('resource-exhausted', 'minute-limit');
    tx.set(ref, { day, counts: { ...(q.counts || {}), [kind]: used + 1 }, min, minCount: minCount + 1, last: Date.now() });
  });
}

let genai = null;
async function gemini() {
  if (process.env.FAKE_AI === '1') return { models: {
    generateContent: async () => { if (process.env.FAKE_FAIL === '1') throw new Error('429 RESOURCE_EXHAUSTED quota'); return { text: 'תשובה לבדיקה' }; },
    generateContentStream: async () => { if (process.env.FAKE_FAIL === '1') throw new Error('429 RESOURCE_EXHAUSTED quota'); return (async function* () { yield { text: 'תשובה ' }; yield { text: 'לבדיקה', candidates: [{ finishReason: 'STOP' }] }; })(); },
  } };
  if (!genai) { const { GoogleGenAI } = await import('@google/genai'); genai = new GoogleGenAI({ apiKey: GEMINI_KEY.value() }); }
  return genai;
}

exports.ai = onCall({
  region: 'europe-west1', secrets: [GEMINI_KEY], enforceAppCheck: process.env.FAKE_AI !== '1',
  timeoutSeconds: 300, memory: '512MiB', maxInstances: 10, concurrency: 40,
}, async (req, res) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'login');
  const { kind, cfg, parts, search, image, urls } = req.data || {};
  let model = (req.data || {}).model;
  if (!Object.prototype.hasOwnProperty.call(LIMIT, kind)) throw new HttpsError('invalid-argument', 'bad-kind');
  const owner = isOwner(req.auth.token);
  const flashOcr = kind === 'ocr' && model === OCR_MODEL;
  const flashSmart = FLASH_KINDS.includes(kind) && model === OCR_MODEL;
  if (image === true ? kind !== 'img' : (kind === 'img' || !(MODELS.includes(model) || flashOcr || flashSmart))) throw new HttpsError('invalid-argument', 'bad-model');
  const contents = [{ role: 'user', parts: cleanParts(parts) }];
  const config = cleanConfig(cfg);
  if (!owner) await takeOne(req.auth.uid, kind);
  // (25.11.2026, עמית: "שיהיה אמיתי") לומיקס רק אחרי שה-AI באמת ענה: שאלה לעוזר – מיד; צילום/כרטיסיות/סיכום/דף תרגול – רק "כרטיס" (pend),
  // והלומיקס ניתנים כשהמשתמש באמת סיים באתר (הכניס למחברת / עבר על 5 כרטיסיות) – questDone. מי שסוגר באמצע לא מקבל
  let credited = false;
  const credit = async t => { if (credited || !String(t || '').trim()) return; credited = true; try { if (kind === 'chat' && !image) await earn(req.auth.uid, 'ask'); else if (PEND_KINDS.includes(kind)) await pendOne(req.auth.uid, kind); } catch {} };   // משימות מתחלפות: כרטיסיות, סיכום, דף תרגול   // משימת היום: לשאול את העוזר   // צילום לוח = גירים (עד 3 ביום)
  try { await takeGlobal(kind, owner); } catch (e) { if (!owner) await refundOne(req.auth.uid, kind); throw e; }
  const failed = async () => { if (!owner) await refundOne(req.auth.uid, kind); };
  if (flashSmart) {
    // שאלה קשה: Flash (חכם יותר) אם יש עוד מכסה היום, אחרת Lite
    try {
      const ok = flashDead !== israelDay() && await db.runTransaction(async tx => {
        const ref = db.doc('aiQuota/_site'), uref = db.doc(`aiQuota/${req.auth.uid}`);
        const sn = await tx.get(ref), un = await tx.get(uref);
        const g = sn.exists ? sn.data() : {}, u = un.exists ? un.data() : {};
        const day = israelDay(), used = g.flashDay === day ? (g.flashToday || 0) : 0;
        const mine = u.day === day ? ((u.counts && u.counts.flashc) || 0) : 0;
        if (used >= FLASH_SMART_DAY || (!owner && mine >= FLASH_SMART_USER)) return false;
        tx.set(ref, { flashDay: day, flashToday: used + 1 }, { merge: true });
        if (!owner) tx.set(uref, { day, counts: { flashc: mine + 1 } }, { merge: true });
        return true;
      });
      if (!ok) model = MODELS[0];
    } catch { model = MODELS[0]; }
    // Flash עם חשיבה גבוהה לוקח יותר מדקה – מספיק בינוני
    if (model === OCR_MODEL && config.thinkingConfig && config.thinkingConfig.thinkingLevel === 'HIGH') config.thinkingConfig = { thinkingLevel: 'MEDIUM' };
  }
  if (flashOcr) {
    try {
      const flashMine = owner ? 0 : (OCR_FLASH_USER + (await streakBoost(req.auth.uid)).flash) * (await isAmb(req.auth.uid) ? AMB_X : 1);
      const ok = await db.runTransaction(async tx => {
        const ref = db.doc('aiQuota/_site'), uref = db.doc(`aiQuota/${req.auth.uid}`);
        const sn = await tx.get(ref), un = await tx.get(uref);
        const g = sn.exists ? sn.data() : {}, u = un.exists ? un.data() : {};
        const day = israelDay(), used = g.flashDay === day ? (g.flashToday || 0) : 0;
        const mine = u.day === day ? ((u.counts && u.counts.flash) || 0) : 0;   // נשמר בתוך counts, ש-takeOne שומר עליו
        if (used >= OCR_FLASH_DAY || (!owner && mine >= flashMine)) return false;
        tx.set(ref, { flashDay: day, flashToday: used + 1 }, { merge: true });
        if (!owner) tx.set(uref, { day, counts: { flash: mine + 1 } }, { merge: true });
        return true;
      });
      if (!ok || flashDead === israelDay()) model = MODELS[0];
    } catch { model = MODELS[0]; }
  }

  const ai = await gemini();
  if (image === true) {
    let lastErr = null;
    for (const m of IMAGE_MODELS) {
      try {
        const r = await ai.models.generateContent({ model: m, contents, config: { responseModalities: ['TEXT', 'IMAGE'] } });
        const ps = r.candidates?.[0]?.content?.parts || [];
        const img = ps.filter(p => p.inlineData && /^image\//.test(p.inlineData.mimeType || '')).map(p => ({ m: p.inlineData.mimeType, d: p.inlineData.data })).slice(0, 2);
        const t = ps.filter(p => typeof p.text === 'string').map(p => p.text).join('').slice(0, 2000);
        if (img.length) return { t, img };
        lastErr = new Error('no-image');
      } catch (e) { lastErr = e; console.warn('image', m, String(e && e.message).slice(0, 200)); if (!/404|not.?found|not supported|NOT_FOUND|INVALID_ARGUMENT/i.test(String(e && e.message))) break; }
    }
    const msg = String(lastErr && lastErr.message || 'no-image').slice(0, 300);
    await failed();
    if (/429|RESOURCE_EXHAUSTED|quota/i.test(msg)) throw new HttpsError('resource-exhausted', 'gemini-quota: ' + msg);
    throw new HttpsError('not-found', 'image-off: ' + msg);
  }
  // חיפוש ב-Google: התשובה מבוססת על אתרים אמיתיים, והם חוזרים כמקורות (src)
  const sources = r => (r.candidates?.[0]?.groundingMetadata?.groundingChunks || []).map(c => c.web).filter(Boolean).map(w => ({ title: String(w.title || '').slice(0, 200), uri: String(w.uri || '').slice(0, 500) }))
    .concat((r.candidates?.[0]?.urlContextMetadata?.urlMetadata || []).filter(u => /SUCCESS/.test(String(u.urlRetrievalStatus || '')) && u.retrievedUrl).map(u => ({ title: String(u.retrievedUrl).replace(/^https?:\/\/(www\.)?/, '').slice(0, 200), uri: String(u.retrievedUrl).slice(0, 500) })));
  let sent = false;
  const run = async cfg2 => {
    if (req.acceptsStreaming) {
      const stream = await ai.models.generateContentStream({ model, contents, config: cfg2 });
      let all = '', src = [];
      for await (const ch of stream) {
        const t = ch.text || '';
        all += t; src = src.concat(sources(ch)); if (t) sent = true;
        await res.sendChunk({ t, f: ch.candidates?.[0]?.finishReason || '', b: ch.promptFeedback?.blockReason || '' });
      }
      await credit(all); return { t: all, src };
    }
    const r = await ai.models.generateContent({ model, contents, config: cfg2 });
    await credit(r.text); return { t: r.text || '', f: r.candidates?.[0]?.finishReason || '', b: r.promptFeedback?.blockReason || '', src: sources(r) };
  };
  try {
    // קישורים בהודעה (urls): Gemini נכנס לדפים וקורא אותם. אפשר יחד עם חיפוש ב-Google
    const tools = [...(urls === true ? [{ urlContext: {} }] : []), ...(search === true ? [{ googleSearch: {} }] : [])];
    if (tools.length) { try { return await run({ ...config, tools }); } catch (e) { if (sent) throw e; console.warn('tools failed, trying without', String(e && e.message).slice(0, 200)); } }
    // גוגל לפעמים עמוסים (503) או שהקריאה נתקעת: מנסים שוב אחרי הפסקה קצרה, ואז עם המודל השני.
    // כל ניסיון מוגבל בזמן, כדי שלא יחכה דקות. ברגע שהתחיל טקסט לזרום לאתר – לא מנסים שוב.
    const transient = e => /503|500|UNAVAILABLE|overloaded|high demand|INTERNAL|DEADLINE|timed? ?out|aborted|fetch failed|ECONNRESET|socket/i.test(String(e && e.message));
    // כל ניסיון: עד 30 שנ' (תמונות ומסמכים – 60), כדי שבזמן עומס אצל גוגל לא נחכה דקות ארוכות
    const heavy = contents[0].parts.some(p => p.inlineData) || kind === 'ocr';
    // (24.11.2026, נמדד: תמונה שעוברת חוזרת תוך 1–3 שנ'; כשגוגל עמוסים בקשה יכולה להיתקע דקה-שתיים ואז 503) – אז ניסיונות קצרים ורבים
    const deep = config.thinkingConfig && /HIGH|MEDIUM/.test(config.thinkingConfig.thinkingLevel);
    const tmo = m => m === OCR_MODEL ? 45000 : heavy ? (deep ? 40000 : 25000) : deep ? 45000 : 30000;
    const lim = { ...config, httpOptions: { timeout: tmo(model) } };
    const no429 = new Set();   // מודלים שכבר אמרו "נגמרה המכסה" – לא מנסים אותם שוב בבקשה הזאת
    const tStart = Date.now();
    // עומס אצל גוגל הוא לכל מודל בנפרד: קודם קופצים מיד למודל קל אחר (בלי לחכות), ורק אחר כך מחכים ומנסים שוב (24.11.2026)
    // אחרי כל כישלון החשיבה יורדת רמה, אז קודם שוב אותו מודל מהיר (בחשיבה נמוכה יותר הוא כמעט תמיד עונה תוך שנייה), ורק אז הגיבוי
    const plan = [[model, 0], [MODELS[0], 0], [MODELS[0], 800], [ALT_LITE[0], 800], [MODELS[0], 2000], [ALT_LITE[0], 2500], [MODELS[0], 3500], [MODELS[0], 5000]];
    let last;
    for (const [m, wait] of plan) {
      if (Date.now() - tStart > (heavy || deep ? 90000 : 60000)) break;   // תקרה לכל הניסיונות יחד
      if (no429.has(m)) continue;
      if (wait) await new Promise(ok => setTimeout(ok, wait));
      model = m; lim.httpOptions = { timeout: tmo(m) };
      try { return await run(lim); }
      catch (e) {
        last = e; if (sent) throw e;
        const msg = String(e && e.message);
        // Flash: נגמרה המכסה / לא קיים – ישר ל-Lite
        if (model === OCR_MODEL && /429|RESOURCE_EXHAUSTED|quota|404|NOT_FOUND|not found/i.test(msg)) { flashDead = israelDay(); console.warn('flash off, using lite', msg.slice(0, 160)); continue; }
        // מכסה של מודל אחד נגמרה – לכל מודל יש מכסה נפרדת, אז ממשיכים לבא בתור (ולא מנסים את זה שוב)
        if (/429|RESOURCE_EXHAUSTED|quota/i.test(msg) && !/prepayment|credits|billing/i.test(msg)) { no429.add(model); console.warn('quota, next model', model, msg.slice(0, 120)); continue; }
        // הגדרה שהמודל לא מקבל (400) – פעם אחת בלי רמת חשיבה ורזולוציה
        if (/INVALID_ARGUMENT|400/.test(msg) && (lim.thinkingConfig || lim.mediaResolution)) { console.warn('bad arg, retry plain', msg.slice(0, 160)); delete lim.thinkingConfig; delete lim.mediaResolution; continue; }
        if (/404|NOT_FOUND/.test(msg)) { no429.add(model); continue; }   // מודל שכבר לא קיים – הבא בתור
        if (!transient(e)) throw e;
        // נבדק 24.11.2026: בזמן עומס גוגל דוחים קודם בקשות עם חשיבה גבוהה (503), ובחשיבה נמוכה זה עובר מיד – אז מורידים רמה בכל ניסיון
        if (lim.thinkingConfig && lim.thinkingConfig.thinkingLevel) lim.thinkingConfig = { thinkingLevel: DOWN[lim.thinkingConfig.thinkingLevel] || 'LOW' };
        console.warn('gemini busy, retry', model, msg.slice(0, 160));
      }
    }
    throw last;
  } catch (e) {
    if (!sent) await failed();
    if (e instanceof HttpsError) throw e;
    const msg = String(e && e.message || e).slice(0, 300);
    console.error('gemini', msg);
    if (/prepayment|credits? (are )?depleted|billing/i.test(msg)) throw new HttpsError('resource-exhausted', 'gemini-credits: ' + msg);
    if (/429|RESOURCE_EXHAUSTED|quota/i.test(msg)) throw new HttpsError('resource-exhausted', 'gemini-quota: ' + msg);
    // גוגל עמוסים גם אחרי כל הניסיונות – קוד ברור, כדי שהאתר יציג הודעה בעברית
    if (/503|UNAVAILABLE|overloaded|high demand/i.test(msg)) throw new HttpsError('unavailable', 'gemini-busy');
    throw new HttpsError('internal', 'gemini: ' + msg);
  }
});

// 🛑 מתג חירום לחיוב: תקציב ב-Google Cloud שולח הודעה לנושא billing-kill (Pub/Sub) כמה פעמים ביום.
// אם ההוצאה החודשית הגיעה לסכום של התקציב – מנתקים את כרטיס החיוב מכל הפרויקטים בחשבון (גם Maps), וכל השירותים בתשלום נעצרים.
// מחזירים ידנית: Billing → My projects → לחבר שוב את חשבון החיוב. (ההרשאה: Billing Account Administrator לחשבון השירות של הפונקציה)
const { onMessagePublished } = require('firebase-functions/v2/pubsub');
const { GoogleAuth } = require('google-auth-library');
exports.billingKill = onMessagePublished({ topic: 'billing-kill', region: 'europe-west1', retry: false }, async event => {
  const d = event.data.message.json || {};
  const cost = +d.costAmount || 0, budget = +d.budgetAmount || 0;
  console.log(`billing: ${cost} / ${budget} ${d.currencyCode || ''} (${d.budgetDisplayName || ''})`);
  const test = d.test === true;   // בדיקה: רק בודקים שיש הרשאות, בלי לנתק כלום
  if (!test && (!budget || cost < budget)) return;
  const own = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  const acct = (event.data.message.attributes || {}).billingAccountId;
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const client = await auth.getClient();
  // כל הפרויקטים בחשבון החיוב (גם Maps). אם לא מצליחים לקבל את הרשימה – לפחות הפרויקט הזה
  let projects = [own];
  if (acct) {
    try {
      const r = await client.request({ url: `https://cloudbilling.googleapis.com/v1/billingAccounts/${acct}/projects?pageSize=100` });
      const list = (r.data.projectBillingInfo || []).filter(x => x.billingEnabled).map(x => x.projectId);
      projects = [...list.filter(x => x !== own), own];   // הפרויקט הזה אחרון
      if (test) console.log(`TEST ok: billing account ${acct} has ${list.length} active projects: ${list.join(', ')}`);
    } catch (e) { console.error('list projects failed', e.message); }
  }
  // בלי לקרוא קודם (לתפקיד Project Billing Manager אין רשות קריאה על הפרויקט) – מנתקים ישר.
  // בבדיקה: שואלים את גוגל אם יש רשות לנתק, בלי לנתק.
  for (const project of projects) {
    try {
      if (test) {
        const r = await client.request({ url: `https://cloudresourcemanager.googleapis.com/v1/projects/${project}:testIamPermissions`, method: 'POST', data: { permissions: ['resourcemanager.projects.deleteBillingAssignment'] } });
        const ok = (r.data.permissions || []).length > 0;
        console.log(`TEST ${ok ? 'ok' : 'NO PERMISSION'}: ${project} ${ok ? 'can disable billing' : 'cannot disable billing'}`);
        continue;
      }
      await client.request({ url: `https://cloudbilling.googleapis.com/v1/projects/${project}/billingInfo`, method: 'PUT', data: { billingAccountName: '' } });
      console.error(`BILLING DISABLED for ${project}: cost ${cost} >= budget ${budget}`);
    } catch (e) { console.error(`${test ? 'TEST ' : ''}disable failed for ${project}`, e.message); }
  }
});

// 👥 קישור לצפייה בלבד: למחברת משותפת יכול להיות עוד קישור (shares/{viewId}, mode: view, src = הקישור הראשי).
// כל שינוי בקישור הראשי – של בעל המחברת או של חבר שעורך – מועתק לכאן, כדי שמי שצופה יראה תמיד את העדכני
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const MIRROR_KEYS = ['title', 'html', 'updatedAt', 'color', 'layout', 'bg', 'orient', 'margin', 'font', 'fs', 'rows', 'updatedBy', 'updatedByName'];
exports.shareMirror = onDocumentWritten({ document: 'shares/{id}', region: 'europe-west1' }, async ev => {
  const a = ev.data && ev.data.after && ev.data.after.exists ? ev.data.after.data() : null;
  const b = ev.data && ev.data.before && ev.data.before.exists ? ev.data.before.data() : null;
  if (!a) { if (b && b.viewId && !b.src) await db.doc(`shares/${b.viewId}`).delete().catch(() => {}); return; }   // הקישור הראשי נמחק – גם הצפייה
  if (a.src || !a.viewId || typeof a.viewId !== 'string' || !/^[A-Za-z0-9]{10,40}$/.test(a.viewId)) return;
  const upd = {};
  for (const k of MIRROR_KEYS) if (k in a && (!b || b.viewId !== a.viewId || JSON.stringify(a[k]) !== JSON.stringify(b[k]))) upd[k] = a[k];
  if (!Object.keys(upd).length) return;
  const ref = db.doc(`shares/${a.viewId}`);
  const v = await ref.get();
  if (!v.exists || v.data().src !== ev.params.id || v.data().owner !== a.owner) return;   // רק קישור צפייה ששייך לקישור הזה
  await ref.update(upd);
});

// 👥 "מי במחברת" גם למי שנכנס לפני שהייתה רשימה (אפילו לפני שנים): כל מי שפתח מחברת משותפת כשהוא מחובר
// נשמר אצלו ב-users/{uid}/shared/{קוד הקישור}. רק השרת יכול לקרוא את זה אצל אחרים – אז בעל המחברת מבקש,
// השרת בודק שהמחברת באמת שלו, ומוסיף לרשימה (members) כל מי שפתח ועוד לא ברשימה – עם שם ואימייל.
// מי שהועף (mode: none) נשאר מועף. מי שפתח בלי להיות מחובר לא נשמר אף פעם, ולכן אי אפשר למצוא אותו.
const { getAuth } = require('firebase-admin/auth');
// נקרא פעם אחת בכל כניסה לאתר: סופר את היום, מחליט על הפרס ומחזיר את המצב
exports.streak = onCall({ region: 'europe-west1', timeoutSeconds: 20 }, async req => {
  const uid = req.auth && req.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'login');
  const ref = db.doc(`streaks/${uid}`), today = israelDay();
  const w0 = (await db.doc(`wallet/${uid}`).get()).data() || {}, back = w0.refBack ? 0 : await refBackCount(uid);
  return db.runTransaction(async tx => {
    const wref = db.doc(`wallet/${uid}`);
    const sn = await tx.get(ref); const s = sn.exists ? sn.data() : { n: 0, best: 0, shield: 1 };
    const wsn = await tx.get(wref); let w = wsn.exists ? wsn.data() : {};
    const rb = refBackIn(w, back); if (rb.w !== w) { w = rb.w; tx.set(wref, w); }
    if (s.last === today) {   // כבר נספר היום – אבל אם הגירים של הכניסה עוד לא ניתנו (למשל נספר לפני שהיו גירים), נותנים עכשיו
      const r = earnIn(tx, w, 'day'); if (r.got) { tx.set(wref, r.w); }
      return { ...s, fresh: false, chalk: r.got + rb.got, friendBack: rb.got };
    }
    const gap = s.last ? today - s.last : 0;
    let n = s.n || 0, shield = s.shield === undefined ? 1 : s.shield, usedShield = false, reset = 0;
    if (s.last && gap === 1) n += 1;
    else if (s.last && gap === 2 && shield) { n += 1; shield = 0; usedShield = true; }
    else { if (n > 1) reset = n; n = 1; shield = 1; }
    if (n > 1 && n % 7 === 0) shield = 1;                       // כל 7 ימים ברצף – המגן חוזר
    const d = streakDayOf(n), out = { last: today, n, best: Math.max(s.best || 0, n), shield, gold: !!s.gold, flashUntil: s.flashUntil || 0, x2Day: s.x2Day || 0, bonusDay: today, bonus: null, big: '' };
    if (d === 7) { out.big = 'lx'; }   // (24.11.2026) עיצוב הזהב כבוי בינתיים – ביום 7 בונוס גדול של לומיקס (earnIn 'big' למטה)
    else if (d === 14) { out.flashUntil = today + 6; out.big = 'flash'; }
    else if (d === 30) { out.x2Day = today; out.big = 'x2'; }
    else { const [k, add] = streakSmall(d); out.bonus = { k, add }; }
    tx.set(ref, out);
    let chalk = 0; { const r1 = earnIn(tx, w, 'day'); w = r1.w; chalk += r1.got; } if (out.big) { const r2 = earnIn(tx, w, 'big'); w = r2.w; chalk += r2.got; }
    if (chalk) tx.set(wref, w);
    streakCache.delete(uid);
    return { ...out, fresh: true, usedShield, reset, chalk: chalk + rb.got, friendBack: rb.got };
  });
});

// חנות הגירים: בודקים שיש מספיק, מורידים, ונותנים את מה שנקנה
exports.shop = onCall({ region: 'europe-west1', timeoutSeconds: 20 }, async req => {
  const uid = req.auth && req.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'login');
  const id = String((req.data || {}).item || ''), it = SHOP[id];
  if (!it || !Object.prototype.hasOwnProperty.call(SHOP, id)) throw new HttpsError('invalid-argument', 'bad-item');
  const wref = db.doc(`wallet/${uid}`), sref = db.doc(`streaks/${uid}`), day = israelDay();
  const res = await db.runTransaction(async tx => {
    const wsn = await tx.get(wref); const w = wsn.exists ? wsn.data() : {};
    const ssn = it.shield ? await tx.get(sref) : null;
    if ((w.bal || 0) < it.p) throw new HttpsError('failed-precondition', 'no-chalk');
    const out = { ...w, bal: (w.bal || 0) - it.p, log: [{ t: 'buy:' + id, a: -it.p, at: Date.now() }, ...(w.log || [])].slice(0, 20) };
    if (it.k) {
      const ex = w.extra && w.extra.day === day ? { day, add: { ...w.extra.add }, n: { ...(w.extra.n || {}) } } : { day, add: {}, n: {} };
      if ((ex.n[id] || 0) >= it.max) throw new HttpsError('resource-exhausted', 'max-today');
      ex.add[it.k] = (ex.add[it.k] || 0) + it.add; ex.n[id] = (ex.n[id] || 0) + 1; out.extra = ex;
    } else if (it.shield) {
      const s = ssn.exists ? ssn.data() : {};
      if (s.shield) throw new HttpsError('already-exists', 'has-shield');
      tx.set(sref, { shield: 1 }, { merge: true });
    } else if (it.skin) {
      const owned = w.owned || [];
      if (owned.includes(id)) throw new HttpsError('already-exists', 'owned');
      out.owned = [...owned, id];
    }
    tx.set(wref, out);
    return { bal: out.bal };
  });
  walletCache.delete(uid); streakCache.delete(uid);
  return res;
});
// מחברת חדשה = גירים (עד 2 ביום). מצגות לא נספרות
// (25.11.2026) רק כשבאמת כתבו בה: הפעם הראשונה שיש בה לפחות 30 אותיות (מחברת ריקה שנפתחה ונסגרה לא נחשבת)
const nbChars = d => String((d && d.html) || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|\s+/g, '').length;
exports.chalkNb2 = onDocumentWritten({ document: 'users/{uid}/notebooks/{id}', region: 'europe-west1', retry: false }, async ev => {
  const b = ev.data && ev.data.before && ev.data.before.exists ? ev.data.before.data() : null, a = ev.data && ev.data.after && ev.data.after.exists ? ev.data.after.data() : null;
  if (!a || a.layout === 'slides' || a.kind === 'pres' || a.trashed || nbChars(a) < 30 || (b && nbChars(b) >= 30)) return;
  const ref = db.doc(`wallet/${ev.params.uid}`), id = ev.params.id;
  try { await db.runTransaction(async tx => { const sn = await tx.get(ref); const w = sn.exists ? sn.data() : {}; const ids = w.nbIds || []; if (ids.includes(id)) return; const r = earnIn(tx, w, 'nb'); tx.set(ref, { ...r.w, nbIds: [...ids, id].slice(-40) }); }); } catch (e) { console.warn('chalkNb2', String(e && e.message).slice(0, 80)); }
});
// (25.11.2026) תשלום חד-פעמי לכולם עכשיו – לא מחכים לכניסה הבאה. מפעילים ע"י יצירת מסמך ב-adminJobs (רק מהקונסול/CLI; לדפדפן אין גישה)
exports.refBackRun = onDocumentCreated({ document: 'adminJobs/{id}', region: 'europe-west1', retry: false }, async ev => {
  const d = ev.data && ev.data.data(); if (!d || d.job !== 'refBack') return;
  const sn = await db.collectionGroup('joined').get(), cnt = {};
  sn.forEach(x => { const ref = x.ref.parent.parent; if (!ref || ref.parent.id !== 'refs') return; const at = +(x.data().at || 0); if (at && at < WALLET_START && ref.id !== x.id) cnt[ref.id] = (cnt[ref.id] || 0) + 1; });
  let people = 0, paid = 0;
  for (const [uid, n] of Object.entries(cnt)) {
    try { const got = await db.runTransaction(async tx => { const wref = db.doc(`wallet/${uid}`); const w0 = await tx.get(wref); const r = refBackIn(w0.exists ? w0.data() : {}, n); if (r.got || !(w0.exists && w0.data().refBack)) tx.set(wref, r.w); return r.got; }); if (got) { people++; paid += got; } } catch (e) { console.warn('refBackRun', String(e && e.message).slice(0, 80)); }
  }
  await ev.data.ref.set({ done: Date.now(), referrers: Object.keys(cnt).length, people, paid }, { merge: true });
});
// המשתמש באמת סיים (הכניס למחברת / עבר על כרטיסיות): אם ה-AI הכין לו את זה היום – מקבל את הלומיקס
exports.questDone = onCall({ region: 'europe-west1', timeoutSeconds: 20 }, async req => {
  const uid = req.auth && req.auth.uid; if (!uid) throw new HttpsError('unauthenticated', 'login');
  const k = String((req.data || {}).k || ''); if (!PEND_KINDS.includes(k)) throw new HttpsError('invalid-argument', 'bad-kind');
  const ref = db.doc(`wallet/${uid}`), day = israelDay();
  return db.runTransaction(async tx => {
    const sn = await tx.get(ref); const w = sn.exists ? sn.data() : {};
    const p = w.pend && w.pend.day === day ? { ...w.pend } : null;
    if (!p || !(p[k] > 0)) return { got: 0 };
    p[k] -= 1; const r = earnIn(tx, w, k); tx.set(ref, { ...r.w, pend: p });
    return { got: r.got };
  });
});
// חבר שהצטרף דרך הקישור שלך = 30 גירים
// (24.11.2026) כל חבר = 20 גירים, עד 10 חברים בחודש (נגד חשבונות מזויפים). fm = {m: 'YYYY-MM', n}
exports.chalkFriend = onDocumentCreated({ document: 'refs/{ref}/joined/{uid}', region: 'europe-west1', retry: false }, async ev => {
  if (ev.params.ref === ev.params.uid) return;
  const ref = db.doc(`wallet/${ev.params.ref}`), mon = new Date(Date.now() + 10800000).toISOString().slice(0, 7);
  try {
    await db.runTransaction(async tx => {
      const sn = await tx.get(ref); const w = sn.exists ? sn.data() : {};
      const fm = w.fm && w.fm.m === mon ? w.fm : { m: mon, n: 0 };
      if (fm.n >= 10) return;
      const r = earnIn(tx, w, 'friend');
      if (r.got) tx.set(ref, { ...r.w, fm: { m: mon, n: fm.n + 1 } });
    });
  } catch (e) { console.warn('chalkFriend', String(e && e.message).slice(0, 80)); }
});

exports.sharePeople = onCall({ region: 'europe-west1', timeoutSeconds: 60 }, async req => {
  const uid = req.auth && req.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'צריך להתחבר');
  const ids = [...new Set((Array.isArray(req.data && req.data.ids) ? req.data.ids : []).filter(x => typeof x === 'string' && /^[A-Za-z0-9]{10,40}$/.test(x)))].slice(0, 2);
  if (!ids.length) throw new HttpsError('invalid-argument', 'חסר קישור');
  const shares = {};
  for (const id of ids) {
    const s = await db.doc(`shares/${id}`).get();
    if (!s.exists || s.data().owner !== uid) throw new HttpsError('permission-denied', 'זו לא המחברת שלך');
    shares[id] = s.data();
  }
  const snap = await db.collectionGroup('shared').get();
  const found = snap.docs.filter(d => shares[d.id] && d.ref.parent.parent && d.ref.parent.parent.parent.id === 'users' && d.ref.parent.parent.id !== uid);
  let added = 0;
  for (const d of found) {
    const fu = d.ref.parent.parent.id, s = shares[d.id];
    const ref = db.doc(`shares/${d.id}/members/${fu}`);
    if ((await ref.get()).exists) continue;
    const u = await getAuth().getUser(fu).catch(() => null);
    if (!u) continue;
    const email = u.email && u.email.length < 200 ? u.email : null;
    const name = String(u.displayName || (email || '').split('@')[0] || 'חבר').slice(0, 79);
    const mode = s.src ? 'view' : (['view', 'copy', 'edit'].includes(s.mode) ? s.mode : 'copy');
    await ref.create({ name, ...(email ? { email } : {}), mode, at: +d.data().openedAt || Date.now() }).then(() => added++).catch(() => {});
  }
  return { added };
});

// ====================== משוב (רק לבעל האתר) ======================
// מתחבר למשוב עם שם המשתמש והסיסמה של משוב, ומביא ציונים, שיעורי בית ואירועי התנהגות לאתר.
// הסיסמה נשמרת מוצפנת (AES-256-GCM) ב-mashovCreds/{uid} – אוסף שאף דפדפן לא יכול לקרוא או לכתוב (אין לו כלל ב-firestore.rules).
// המפתח להצפנה הוא סוד בשרת (MASHOV_KEY), לא בקוד ולא במסד הנתונים.
// אין למשוב חיבור רשמי – זה אותו חיבור שהאפליקציה של משוב משתמשת בו, ויכול להשתנות.
const { onSchedule } = require('firebase-functions/v2/scheduler');
const MASHOV_KEY = defineSecret('MASHOV_KEY');
const MSH = 'https://web.mashov.info/api';
const mshKey = () => crypto.createHash('sha256').update(MASHOV_KEY.value()).digest();
function mshEnc(text) { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', mshKey(), iv); const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]); return { iv: iv.toString('base64'), enc: enc.toString('base64'), tag: c.getAuthTag().toString('base64') }; }
function mshDec(o) { const d = crypto.createDecipheriv('aes-256-gcm', mshKey(), Buffer.from(o.iv, 'base64')); d.setAuthTag(Buffer.from(o.tag, 'base64')); return Buffer.concat([d.update(Buffer.from(o.enc, 'base64')), d.final()]).toString('utf8'); }
const mshYear = () => { const n = new Date(); return n.getMonth() >= 7 ? n.getFullYear() + 1 : n.getFullYear(); };   // שנת הלימודים לפי משוב (תשפ"ז = 2027)
async function mshLogin({ semel, year, username, password }) {
  const r = await fetch(MSH + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
    body: JSON.stringify({ semel: +semel, year: +year, username, password, appName: 'info.mashov.students', apiVersion: '3.20210425', appVersion: '3.20210425', appBuild: '3.20210425', deviceUuid: 'chrome', devicePlatform: 'chrome', deviceManufacturer: 'win', deviceModel: 'desktop', deviceVersion: '120.0.0.0' }) });
  console.log('mashov login', r.status);
  if (r.status === 401 || r.status === 403) throw new HttpsError('permission-denied', 'שם המשתמש או הסיסמה של משוב לא נכונים');
  if (!r.ok) throw new HttpsError('unavailable', 'משוב לא ענה (' + r.status + ')');
  const body = await r.json().catch(() => ({}));
  const uid = body && body.credential && body.credential.userId;
  const csrf = r.headers.get('x-csrf-token') || '';
  const cookies = (r.headers.getSetCookie ? r.headers.getSetCookie() : []).map(c => c.split(';')[0]).filter(Boolean);
  if (!uid) throw new HttpsError('unavailable', 'משוב לא החזיר משתמש – אולי הכניסה אצלם השתנתה');
  return { uid, headers: { 'X-Csrf-Token': csrf, Cookie: [...cookies, 'Csrf-Token=' + csrf].join('; '), Accept: 'application/json' } };
}
async function mshGet(s, path) { const r = await fetch(MSH + path, { headers: { ...s.headers, 'User-Agent': 'Mozilla/5.0' } }); console.log('mashov get', path.replace(/\/students\/[^/]+/, '/students/*'), r.status); if (!r.ok) return null; return r.json().catch(() => null); }
const ymd = t => { const d = new Date(t); return isNaN(d) ? '' : new Date(d.getTime() + 10800000).toISOString().slice(0, 10); };
function grType(n) {
  n = String(n || '');
  if (/מבחן|בחינה|מתכונת|בגרות/.test(n)) return 'מבחנים';
  if (/בוחן|בחנים|(^|\s)בחן/.test(n)) return 'בחנים';
  if (/עבוד|פרויקט|פרוייקט|מטלה|מטלת/.test(n)) return 'עבודות';
  if (/שיעורי.?בית|ש["״]ב/.test(n)) return 'שיעורי בית';
  if (/השתתפות|התנהגות|נוכחות/.test(n)) return 'השתתפות';
  return '';
}
async function mshSync(uid) {
  const cs = await db.doc(`mashovCreds/${uid}`).get();
  if (!cs.exists) throw new HttpsError('failed-precondition', 'עוד לא התחברת למשוב');
  const c = cs.data(); const s = await mshLogin({ ...c, password: mshDec(c.pw) });
  const [gr, hw, bh] = await Promise.all([mshGet(s, `/students/${s.uid}/grades`), mshGet(s, `/students/${s.uid}/homework`), mshGet(s, `/students/${s.uid}/behave`)]);
  const out = { grades: 0, hw: 0, behave: 0 };
  // ציונים → meta/grades (רק ציון שהוא מספר; לא נוגעים בציונים שהוספת בעצמך)
  if (Array.isArray(gr)) {
    const ref = db.doc(`users/${uid}/meta/grades`), cur = await ref.get(), d = cur.exists ? cur.data() : {};
    const items = Array.isArray(d.items) ? d.items : [];
    for (const g of gr) {
      if (g.grade === null || g.grade === undefined || g.grade === '') continue;
      const val = Number(g.grade); if (!isFinite(val)) continue;
      const id = 'm' + (g.id || g.gradingEventId), n = String(g.gradingEvent || g.gradeType || 'ציון').slice(0, 80);
      const it = { id, s: String(g.subjectName || g.groupName || '').slice(0, 40), n, g: val, t: grType(n + ' ' + (g.gradeType || '')), d: ymd(g.eventDate || g.timestamp) };
      const i = items.findIndex(x => x.id === id);
      if (i < 0) { items.push(it); out.grades++; } else if (items[i].g !== val) { items[i] = { ...items[i], g: val }; out.grades++; }
    }
    await ref.set({ items, updatedAt: Date.now() }, { merge: true });
  }
  // שיעורי בית מ-3 השבועות האחרונים → היומן (כל אחד פעם אחת, לא דורסים "בוצע")
  if (Array.isArray(hw)) {
    const from = ymd(Date.now() - 21 * 864e5);
    for (const h of hw) {
      const date = ymd(h.lessonDate), text = String(h.homework || '').trim();
      if (!date || date < from || !text) continue;
      const ref = db.doc(`users/${uid}/events/mashov-hw-${String(h.lessonId || date + text.length).replace(/[^\w-]/g, '')}`);
      if ((await ref.get()).exists) continue;
      await ref.set({ title: `${h.subjectName || 'שיעורי בית'}: ${text}`.slice(0, 80), note: text.slice(0, 1000) + '\n(ממשוב – ניתן בשיעור)', type: 'hw', date, time: '', done: false, createdAt: Date.now(), mashov: true });
      out.hw++;
    }
  }
  // התנהגות (חיסורים, איחורים, הערות) – 40 האחרונים, לחלון של משוב באתר
  const beh = Array.isArray(bh) ? bh.map(b => ({ d: ymd(b.lessonDate || b.timestamp), s: String(b.subject || '').slice(0, 40), n: String(b.achvaName || '').slice(0, 60), j: !!(b.justificationId > 0 || b.justified > 0) })).filter(b => b.d && b.n).sort((a, b) => b.d.localeCompare(a.d)).slice(0, 40) : [];
  out.behave = beh.length;
  await db.doc(`users/${uid}/meta/mashov`).set({ on: true, last: Date.now(), err: null, beh, got: out, ok: { grades: Array.isArray(gr), hw: Array.isArray(hw), behave: Array.isArray(bh) } }, { merge: true });
  return out;
}
// חומר למבחן מהמשוב: הודעות מהמורים ושיעורי בית של המקצוע (לתוכנית למידה באתר)
const mshNorm = t => String(t || '').replace(/["׳״'`]/g, '').replace(/[^\u0590-\u05FFa-zA-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
const mshText = h => String(h || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr)>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
async function mshMaterial(uid, q) {
  const cs = await db.doc(`mashovCreds/${uid}`).get();
  if (!cs.exists) throw new HttpsError('failed-precondition', 'עוד לא התחברת למשוב');
  const c = cs.data(); const s = await mshLogin({ ...c, password: mshDec(c.pw) });
  const nq = mshNorm(q), words = nq.split(' ').filter(w => w.length >= 2);
  const hit = t => { const n = mshNorm(t); return !!n && (n.includes(nq) || (nq.length >= 2 && nq.includes(n)) || words.some(w => w.length >= 3 && n.includes(w))); };
  const out = [];
  // שיעורי בית של המקצוע (כל השנה, החדשים קודם)
  const hw = await mshGet(s, `/students/${s.uid}/homework`);
  if (Array.isArray(hw)) hw.filter(h => hit(h.subjectName) && String(h.homework || '').trim()).sort((a, b) => String(b.lessonDate).localeCompare(String(a.lessonDate))).slice(0, 25)
    .forEach(h => out.push({ k: 'hw', id: 'h' + (h.lessonId || ''), t: String(h.homework).trim().slice(0, 120), d: ymd(h.lessonDate), text: String(h.homework).trim().slice(0, 3000), from: String(h.subjectName || '') }));
  // הודעות במשוב: נושא / שולח / תוכן שקשורים למקצוע
  const inbox = await mshGet(s, '/mail/inbox/conversations?skip=0&take=60');
  const convs = Array.isArray(inbox) ? inbox : [];
  const pick = [];
  for (const cv of convs) {
    const m0 = Array.isArray(cv.messages) ? cv.messages[0] || {} : {};
    const blob = [cv.subject, m0.senderName, m0.sender, m0.body, m0.preview].join(' ');
    if (hit(blob)) pick.push(cv);
    if (pick.length >= 8) break;
  }
  for (const cv of pick) {
    const full = await mshGet(s, `/mail/conversations/${encodeURIComponent(cv.conversationId)}`);
    const msgs = full && Array.isArray(full.messages) ? full.messages : Array.isArray(cv.messages) ? cv.messages : [];
    const text = msgs.map(m => mshText(m.body || m.content || '')).filter(Boolean).join('\n\n').slice(0, 6000);
    const files = msgs.flatMap(m => Array.isArray(m.files) ? m.files : []).map(f => String(f.fileName || f.name || '')).filter(Boolean).slice(0, 10);
    const m0 = msgs[0] || {};
    out.push({ k: 'mail', id: 'm' + cv.conversationId, t: String(cv.subject || 'הודעה').slice(0, 120), d: ymd(cv.sendTime || m0.sendTime), text, files, from: String(m0.senderName || m0.sender || '').slice(0, 60) });
  }
  console.log('mashov mat', q, 'hw', out.filter(x => x.k === 'hw').length, 'mail', pick.length, 'inbox', convs.length);
  return { items: out };
}
let mshSchools = null;
exports.mashov = onCall({ region: 'me-west1', secrets: [MASHOV_KEY], timeoutSeconds: 120 }, async req => {
  const uid = req.auth && req.auth.uid;
  if (!uid || !isOwner(req.auth.token)) throw new HttpsError('permission-denied', 'החיבור למשוב רק לבעל האתר');
  const a = (req.data && req.data.a) || '';
  if (a === 'schools') {
    if (!mshSchools || !mshSchools.length) { const r = await fetch(MSH + '/schools', { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' } }); const l = r.ok ? await r.json().catch(() => []) : []; console.log('mashov schools', r.status, Array.isArray(l) ? l.length : typeof l); mshSchools = (Array.isArray(l) ? l : []).map(x => ({ id: x.semel, n: x.name })).filter(x => x.id && x.n); if (!mshSchools.length) throw new HttpsError('unavailable', 'משוב לא החזיר רשימת בתי ספר (' + r.status + ')'); }
    return { schools: mshSchools, year: mshYear() };
  }
  if (a === 'save') {
    const { semel, username, password } = req.data; const year = +req.data.year || mshYear();
    if (!/^\d{3,8}$/.test(String(semel)) || typeof username !== 'string' || typeof password !== 'string' || !username || !password || username.length > 60 || password.length > 100) throw new HttpsError('invalid-argument', 'חסרים פרטים');
    await mshLogin({ semel, year, username, password });          // בודקים שזה עובד לפני ששומרים
    await db.doc(`mashovCreds/${uid}`).set({ semel: +semel, year, username, pw: mshEnc(password), at: Date.now() });
    return mshSync(uid);
  }
  if (a === 'sync') return mshSync(uid).catch(async e => { await db.doc(`users/${uid}/meta/mashov`).set({ err: String(e.message || e).slice(0, 200), errAt: Date.now() }, { merge: true }); throw e; });
  if (a === 'mat') return mshMaterial(uid, String((req.data && req.data.q) || '').slice(0, 60));
  if (a === 'off') { await db.doc(`mashovCreds/${uid}`).delete(); await db.doc(`users/${uid}/meta/mashov`).set({ on: false, beh: [] }, { merge: true }); return { ok: true }; }
  throw new HttpsError('invalid-argument', 'פעולה לא ידועה');
});
// כל יום ב-16:00 (שעון ישראל) – מביא דברים חדשים ממשוב לבד
exports.mashovDaily = onSchedule({ schedule: '0 16 * * *', timeZone: 'Asia/Jerusalem', region: 'me-west1', secrets: [MASHOV_KEY], timeoutSeconds: 300 }, async () => {
  const all = await db.collection('mashovCreds').get();
  for (const d of all.docs) await mshSync(d.id).catch(e => db.doc(`users/${d.id}/meta/mashov`).set({ err: String(e.message || e).slice(0, 200), errAt: Date.now() }, { merge: true }));
});

// ================================================================================================
// 📲 בוט וואטסאפ: מצלמים את הלוח, שולחים לבוט, והטקסט נכנס לבד למחברת המתאימה (למשל "מתמטיקה").
// איך זה עובד:
//   1. באתר: תפריט ← "וואטסאפ" ← מקבלים קוד של 6 ספרות (waLink) ושולחים אותו לבוט. ככה המספר מחובר לחשבון.
//   2. Meta שולחת כל הודעה לבוט לכתובת whatsapp. היא נשמרת ב-waInbox ועונים 200 מיד (Meta לא אוהבת לחכות).
//   3. waProcess קורא את התמונה עם Gemini, בוחר מחברת (לפי הכיתוב של התמונה, ואם אין – לפי התוכן),
//      מוסיף לסוף המחברת את התמונה ואת הטקסט, ועונה בוואטסאפ לאיזו מחברת זה נכנס.
// הבוט עושה רק את זה: מקבל תמונות ושומר אותן במחברת. הוא לא צ'אט כללי (כך דורשים הכללים של WhatsApp Business).
// הגדרה: ראו WHATSAPP_SETUP.md
// ================================================================================================
const { onRequest } = require('firebase-functions/v2/https');

const { defineString } = require('firebase-functions/params');
const { FieldValue } = require('firebase-admin/firestore');
const WA_TOKEN = defineSecret('WA_TOKEN');               // טוקן קבוע של System User ב-Meta
const WA_APP_SECRET = defineSecret('WA_APP_SECRET');     // App secret – לבדוק שההודעה באמת מ-Meta
const WA_VERIFY = defineSecret('WA_VERIFY_TOKEN');       // מחרוזת שאנחנו ממציאים, לאימות ה-webhook
const WA_PHONE_ID = defineString('WA_PHONE_ID');         // Phone number ID של הבוט (בקובץ functions/.env)
const GRAPH = 'https://graph.facebook.com/' + (process.env.WA_GRAPH_VERSION || 'v23.0');
const SITE = 'https://amitshabatgoltz-create.github.io/my-notebooks/';
const WA_REGION = 'europe-west1';
const phoneKey = p => crypto.createHash('sha256').update('my-notebooks-wa:' + String(p)).digest('hex');
const CODE_MIN = 10;   // הקוד תקף 10 דקות

// אותן הוראות כמו "צילום לוח" באתר (OCR_PROMPT ב-app.js), בקיצור
const WA_OCR_PROMPT = `אתה מקבל תמונה של לוח בכיתה, דף מחברת בכתב יד או דף מודפס, בעברית (לפעמים גם אנגלית/מתמטיקה).
זה צילום אמיתי מטלפון: לפעמים בזווית, מטושטש, עם צל או השתקפות. אם יש טקסט – קרא אותו בכל זאת.
הקלד את כל התוכן בדיוק כפי שהוא כתוב, לפי הסדר (מימין לשמאל, מלמעלה למטה).
החזר HTML נקי בלבד, בלי הסברים ובלי \`\`\`:
- כותרות: <h2> לכותרת ראשית, <h3> לכותרת משנה. טקסט: <p>. רשימות: <ul>/<ol> עם <li>. טבלה: <table> עם <tr>/<td>. הדגשה: <b>.
- חצים וקשרים בין רעיונות: כתוב כטקסט עם "←".
- לא להמציא. כתוב רק מילים שבאמת רואים. אל תשלים, אל תסכם, אל תנסח מחדש.
- מילה לא ברורה: כתוב את מה שהכי קרוב לצורת האותיות. חלק שלא קריא בכלל – דלג.
- דלג על דברים שלא קשורים לחומר: רשימת תורנים ושמות תלמידים, תאריך בפינת הלוח, "לא למחוק", הודעות כלליות.`;

const WA_TAGS = new Set(['h2', 'h3', 'h4', 'p', 'ul', 'ol', 'li', 'b', 'strong', 'i', 'em', 'u', 'br', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'sub', 'sup']);
// HTML מ-Gemini: משאירים רק תגיות פשוטות ובלי שום מאפיין (האתר מנקה שוב כשהוא פותח את המחברת)
function waCleanHtml(s) {
  return String(s || '')
    .replace(/<(script|style|iframe|object)[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?([a-zA-Z0-9]+)(\s[^>]*)?>/g, (m, t) => { t = t.toLowerCase(); return WA_TAGS.has(t) ? (m[1] === '/' ? `</${t}>` : `<${t}>`) : ''; })
    .replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/, '').trim().slice(0, 200000);
}
const norm = s => String(s || '').toLowerCase().replace(/["׳״'`]/g, '').replace(/[.,:;!?()\-–_]/g, ' ').replace(/\s+/g, ' ').trim();
const escHtml = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function waSend(to, body) {
  try {
    const r = await fetch(`${GRAPH}/${WA_PHONE_ID.value().trim()}/messages`, {
      method: 'POST', headers: { Authorization: `Bearer ${WA_TOKEN.value().trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: String(body).slice(0, 4000), preview_url: false } }),
    });
    if (!r.ok) console.warn('wa send', r.status, (await r.text()).slice(0, 300));
  } catch (e) { console.warn('wa send', String(e && e.message).slice(0, 200)); }
}

async function waMedia(id) {
  const h = { Authorization: `Bearer ${WA_TOKEN.value().trim()}` };
  const meta = await (await fetch(`${GRAPH}/${encodeURIComponent(id)}`, { headers: h })).json();
  if (!meta || !meta.url) throw new Error('media-meta');
  if (meta.file_size && meta.file_size > 16e6) throw new Error('too-big');
  const r = await fetch(meta.url, { headers: h });
  if (!r.ok) throw new Error('media-get ' + r.status);
  return { buf: Buffer.from(await r.arrayBuffer()), mime: meta.mime_type || 'image/jpeg' };
}

// התמונה נשמרת כמו באתר: users/<uid>/images/<id> עם data URL קטן מ-900KB
async function waSaveImage(uid, buf) {
  const sharp = require('sharp');
  let side = 1400, q = 80, out;
  for (let i = 0; i < 6; i++) {
    out = await sharp(buf).rotate().resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: q }).toBuffer();
    if (out.length * 4 / 3 < 880000) break;
    side = Math.round(side * 0.8); q = Math.max(50, q - 8);
  }
  const ref = db.collection(`users/${uid}/images`).doc();
  await ref.set({ data: 'data:image/jpeg;base64,' + out.toString('base64'), createdAt: Date.now(), from: 'whatsapp' });
  return ref.id;
}

// ---- 1. האתר מבקש קוד חיבור / ניתוק ----
exports.waLink = onCall({ region: WA_REGION }, async req => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'login');
  const uid = req.auth.uid, a = (req.data || {}).a;
  if (a === 'code') {
    for (let i = 0; i < 5; i++) {
      const code = String(crypto.randomInt(100000, 1000000));
      try { await db.doc(`waCodes/${code}`).create({ uid, exp: Date.now() + CODE_MIN * 60000 }); return { code, minutes: CODE_MIN }; }
      catch { /* הקוד תפוס – מנסים אחר */ }
    }
    throw new HttpsError('unavailable', 'נסו שוב');
  }
  if (a === 'off') {
    const ref = db.doc(`users/${uid}/meta/whatsapp`); const sn = await ref.get();
    if (sn.exists && sn.data().key) await db.doc(`waLinks/${sn.data().key}`).delete().catch(() => {});
    await ref.delete().catch(() => {});
    return { ok: true };
  }
  throw new HttpsError('invalid-argument', 'bad-action');
});

// ---- 2. Meta שולחת לכאן כל הודעה ----
exports.whatsapp = onRequest({ region: WA_REGION, secrets: [WA_APP_SECRET, WA_VERIFY], maxInstances: 5, invoker: 'public' }, async (req, res) => {
  if (req.method === 'GET') {   // אימות חד-פעמי כשמגדירים את ה-webhook ב-Meta
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === WA_VERIFY.value().trim()) return res.status(200).send(String(req.query['hub.challenge'] || ''));
    return res.sendStatus(403);
  }
  if (req.method !== 'POST') return res.sendStatus(405);
  // בודקים שההודעה באמת מ-Meta (חתימה עם ה-App secret)
  const sig = String(req.get('x-hub-signature-256') || '');
  const want = 'sha256=' + crypto.createHmac('sha256', WA_APP_SECRET.value().trim()).update(req.rawBody || Buffer.alloc(0)).digest('hex');
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return res.sendStatus(401);
  const msgs = [];
  for (const e of (req.body && req.body.entry) || []) for (const c of e.changes || []) for (const m of (c.value && c.value.messages) || []) msgs.push(m);
  await Promise.all(msgs.slice(0, 20).map(m => {
    const d = { from: String(m.from || '').replace(/\D/g, '').slice(0, 20), type: String(m.type || ''), at: Date.now() };
    if (!d.from) return null;
    if (m.type === 'text') d.text = String((m.text && m.text.body) || '').slice(0, 500);
    else if (m.type === 'image' && m.image) { d.media = String(m.image.id || ''); d.caption = String(m.image.caption || '').slice(0, 200); }
    else if (m.type === 'document' && m.document && /^(image\/|application\/pdf)/.test(m.document.mime_type || '')) { d.type = 'image'; d.media = String(m.document.id || ''); d.caption = String(m.document.caption || '').slice(0, 200); d.pdf = /pdf/.test(m.document.mime_type); }
    // create נכשל אם ההודעה כבר הגיעה – Meta לפעמים שולחת פעמיים, וככה מטפלים בה רק פעם אחת
    return db.doc(`waInbox/${crypto.createHash('sha256').update(String(m.id || Math.random())).digest('hex').slice(0, 40)}`).create(d).catch(() => {});
  }));
  res.sendStatus(200);
});

// ---- 3. מטפלים בהודעה ----
exports.waProcess = onDocumentCreated({ document: 'waInbox/{id}', region: WA_REGION, secrets: [WA_TOKEN, GEMINI_KEY], timeoutSeconds: 180, memory: '1GiB', maxInstances: 5, retry: false }, async ev => {
  const m = ev.data && ev.data.data(); if (!m || !m.from) return;
  try { await waHandle(m); }
  catch (e) { console.error('wa', String(e && e.message).slice(0, 300)); await waSend(m.from, 'משהו השתבש 😕 נסו לשלוח את התמונה שוב בעוד דקה.'); }
  finally { await ev.data.ref.update({ done: true, from: FieldValue.delete(), text: FieldValue.delete(), caption: FieldValue.delete() }).catch(() => {}); }
});

const WA_HELP = 'שלחו לכאן צילום של הלוח או של דף מהמחברת, והוא ייכנס לבד למחברת המתאימה 📷\nכדי לבחור מחברת, כתבו את השם שלה בכיתוב של התמונה (למשל: מתמטיקה).\nלמחיקה של מה שנכנס בפעם האחרונה כתבו: מחק\nלניתוק כתבו: ניתוק';

async function waHandle(m) {
  const key = phoneKey(m.from);
  const link = await db.doc(`waLinks/${key}`).get();
  const uid = link.exists ? link.data().uid : null;

  if (m.type === 'text') {
    const t = String(m.text || '').trim();
    const code = (t.match(/(?:^|\D)(\d{6})(?:\D|$)/) || [])[1];
    if (code) {   // חיבור המספר לחשבון
      const cref = db.doc(`waCodes/${code}`);
      const got = await db.runTransaction(async tx => {
        const c = await tx.get(cref);
        if (!c.exists || c.data().exp < Date.now()) return null;
        const u = c.data().uid; const mref = db.doc(`users/${u}/meta/whatsapp`); const prev = await tx.get(mref);
        if (prev.exists && prev.data().key && prev.data().key !== key) tx.delete(db.doc(`waLinks/${prev.data().key}`));
        if (uid && uid !== u) tx.delete(db.doc(`users/${uid}/meta/whatsapp`));   // המספר היה מחובר לחשבון אחר
        tx.delete(cref);
        tx.set(db.doc(`waLinks/${key}`), { uid: u, at: Date.now() });
        tx.set(mref, { on: true, key, last4: m.from.slice(-4), at: Date.now() });
        return u;
      });
      return waSend(m.from, got ? '✅ מחובר! מעכשיו כל צילום של הלוח שתשלחו לכאן ייכנס למחברת המתאימה.\n\n' + WA_HELP : 'הקוד לא נכון או שעבר הזמן שלו. מקבלים קוד חדש באתר: תפריט ← וואטסאפ.');
    }
    // "מחק" – מוחקים מהמחברת את מה שהבוט הכניס בפעם האחרונה
    if (/^(מחק|תמחק|למחוק|בטל|ביטול|undo)/i.test(t) && !/(ניתוק|נתק)/.test(t)) {
      if (!uid) return waSend(m.from, 'קודם צריך לחבר את המספר באתר.');
      const mref = db.doc(`users/${uid}/meta/whatsapp`); const ms = await mref.get(); const u = ms.exists && ms.data().undo;
      if (!u || !u.nb) return waSend(m.from, 'אין משהו למחוק – עוד לא הכנסתי כלום, או שכבר מחקתי.');
      const ref = db.doc(`users/${uid}/notebooks/${u.nb}`); let ok = false, title = 'המחברת';
      await db.runTransaction(async tx => {
        const sn = await tx.get(ref); if (!sn.exists) return; const cur = sn.data(); title = cur.title || title;
        const html = String(cur.html || ''), i = html.lastIndexOf(u.block); if (i < 0) return;
        const rest = html.slice(0, i) + html.slice(i + u.block.length), now = Date.now(); ok = true;
        if (u.isNew && !rest.replace(/<[^>]+>/g, '').trim()) tx.update(ref, { html: rest, trashed: now, updatedAt: now, wa: { at: now, html: '' } });   // מחברת שהבוט יצר ונשארה ריקה – לפח
        else tx.update(ref, { html: rest, updatedAt: now, wa: { at: now, html: '' } });
      });
      await mref.set({ undo: null }, { merge: true });
      if (ok && u.img) await db.doc(`users/${uid}/images/${u.img}`).delete().catch(() => {});
      return waSend(m.from, ok ? `נמחק מהמחברת "${title}" ✓` : 'לא מצאתי את זה במחברת – אולי כבר שינית את זה באתר.');
    }
    if (/^(ניתוק|נתק|stop|unlink)$/i.test(t)) {
      if (uid) { await db.doc(`waLinks/${key}`).delete(); await db.doc(`users/${uid}/meta/whatsapp`).delete().catch(() => {}); }
      return waSend(m.from, 'התנתקתם. התמונות לא ייכנסו יותר למחברות. אפשר להתחבר שוב מהאתר מתי שרוצים.');
    }
    return waSend(m.from, uid ? WA_HELP : `היי! כדי שהתמונות ייכנסו למחברות שלכם, צריך קודם לחבר את המספר:\nבאתר ${SITE} ← תפריט ← וואטסאפ ← לשלוח לכאן את הקוד.`);
  }

  if (m.type !== 'image' || !m.media) return waSend(m.from, uid ? WA_HELP : `כדי להתחיל, מחברים את המספר באתר: ${SITE} ← תפריט ← וואטסאפ.`);
  if (!uid) return waSend(m.from, `קודם צריך לחבר את המספר לחשבון: ${SITE} ← תפריט ← וואטסאפ ← לשלוח לכאן את הקוד.`);

  // מכסה – בדיוק כמו "צילום לוח" באתר
  let owner = false;
  try { const { getAuth } = require('firebase-admin/auth'); const u = await getAuth().getUser(uid); owner = isOwner({ email: u.email, email_verified: u.emailVerified }); } catch {}
  if (!owner) {
    try { await takeOne(uid, 'ocr'); }
    catch (e) { return waSend(m.from, String(e && e.message) === 'daily-limit' ? 'נגמרו התמונות להיום ⏰ מחר אפשר שוב.' : 'רגע, שלחתם הרבה בבת אחת. נסו שוב בעוד דקה.'); }
  }
  try { await takeGlobal('ocr', owner); }
  catch { if (!owner) await refundOne(uid, 'ocr'); return waSend(m.from, 'יש עכשיו עומס. נסו לשלוח שוב בעוד כמה דקות.'); }

  let done = false;
  waSend(m.from, 'קיבלתי! מקליד את מה שבתמונה… (בערך חצי דקה)');   // לא מחכים – שהתלמיד יידע שזה בדרך
  try {
    const { buf, mime } = await waMedia(m.media);
    const isPdf = m.pdf || /pdf/.test(mime);
    // המחברות של התלמיד (בלי מה שבפח)
    const snap = await db.collection(`users/${uid}/notebooks`).select('title', 'subject', 'trashed', 'updatedAt').get();
    const nbs = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(n => !n.trashed).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 40);
    // 1. הכיתוב של התמונה ("מתמטיקה", "היסטוריה") – הכי בטוח
    const cap = norm(m.caption);
    let target = null;
    if (cap) target = nbs.find(n => norm(n.title) === cap || norm(n.subject) === cap)
      || nbs.find(n => (norm(n.title) && (norm(n.title).includes(cap) || cap.includes(norm(n.title)))) || (norm(n.subject) && cap.includes(norm(n.subject))));
    // 2. אם אין – Gemini בוחר לפי התוכן מתוך הרשימה
    const list = nbs.map((n, i) => `${i + 1}. ${n.title || 'מחברת'}${n.subject ? ` (מקצוע: ${n.subject})` : ''}`).join('\n');
    const pick = target ? '' : `\n\nבסוף, בשורות נפרדות:
<!--nb: מספר-->  – המספר של המחברת שהכי מתאימה לתוכן מהרשימה למטה, לפי המקצוע. אם אף אחת לא מתאימה באמת – 0.
<!--subject: שם המקצוע בקצרה, למשל מתמטיקה / תנ"ך / אנגלית-->
${cap ? `התלמיד כתב ליד התמונה: "${String(m.caption).slice(0, 100)}" – אם זה שם של מקצוע, הוא קובע.\n` : ''}המחברות של התלמיד:\n${list || '(אין עדיין מחברות)'}`;
    const ai = await gemini();
    const parts = [{ inlineData: { mimeType: isPdf ? 'application/pdf' : (/^image\//.test(mime) ? mime : 'image/jpeg'), data: buf.toString('base64') } }, { text: WA_OCR_PROMPT + pick }];
    // Gemini לפעמים עמוס (503) – מנסים כמה פעמים עם הפסקה, ועוברים למודל השני אם צריך
    // מהר: חשיבה קצרה, וכל ניסיון עד 40 שנ' (בלי זה ניסיון אחד יכול לחכות דקה ויותר)
    const T = { httpOptions: { timeout: 40000 } };
    const tries = [[MODELS[0], { temperature: 0, thinkingConfig: { thinkingLevel: 'LOW' }, mediaResolution: 'MEDIA_RESOLUTION_HIGH', ...T }, 0], [OCR_MODEL, { temperature: 0, thinkingConfig: { thinkingLevel: 'LOW' }, ...T }, 1500], [MODELS[0], { temperature: 0, ...T }, 5000], [OCR_MODEL, { temperature: 0, ...T }, 10000]];
    let r, lastErr;
    for (const [model, config, wait] of tries) {
      if (wait) await new Promise(ok => setTimeout(ok, wait));
      try { r = await ai.models.generateContent({ model, contents: [{ role: 'user', parts }], config }); break; }
      catch (e) { lastErr = e; console.warn('wa gemini', model, String(e && e.message).slice(0, 160)); }
    }
    if (!r) { const busy = /503|UNAVAILABLE|overloaded|high demand|429/i.test(String(lastErr && lastErr.message)); if (busy) { done = false; return waSend(m.from, 'ה-AI עמוס עכשיו. נסו לשלוח את התמונה שוב בעוד כמה דקות.'); } throw lastErr; }
    const raw = String(r.text || '');
    const html = waCleanHtml(raw);
    if (!html.replace(/<[^>]+>/g, '').trim()) { if (!owner) await refundOne(uid, 'ocr'); done = true; return waSend(m.from, 'לא מצאתי טקסט בתמונה 🤔 נסו צילום קרוב וברור יותר.'); }
    const subject = ((raw.match(/<!--\s*subject:\s*([^>]*?)\s*-->/) || [])[1] || '').replace(/[<>]/g, '').slice(0, 40);
    if (!target) { const k = +((raw.match(/<!--\s*nb:\s*(\d+)\s*-->/) || [])[1] || 0); if (k >= 1 && k <= nbs.length) target = nbs[k - 1]; }
    if (!target && subject) target = nbs.find(n => norm(n.subject) === norm(subject) || norm(n.title) === norm(subject)) || null;

    const imgId = isPdf ? null : await waSaveImage(uid, buf).catch(e => { console.warn('wa img', String(e && e.message).slice(0, 200)); return null; });
    const d = new Date(Date.now() + 2 * 3600e3);   // התאריך לפי שעון ישראל (בערך – מספיק לכותרת)
    const when = `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
    const block = `<h3>מהלוח · ${when}</h3>${imgId ? `<p><img data-img="${imgId}" data-u="${uid}"></p>` : ''}${html}<p><br></p>`;
    const now = Date.now(); let title, newNbId = null;
    if (target) {
      const ref = db.doc(`users/${uid}/notebooks/${target.id}`);
      await db.runTransaction(async tx => {
        const sn = await tx.get(ref); const cur = sn.exists ? sn.data() : {};
        title = cur.title || target.title || 'המחברת';
        tx.update(ref, { html: (cur.html || '') + block, updatedAt: now, wa: { at: now, html: block } });
      });
    } else {
      title = (cap && m.caption.trim().slice(0, 40)) || subject || 'מהוואטסאפ';
      newNbId = (await db.collection(`users/${uid}/notebooks`).add({ title, ...(subject ? { subject } : {}), color: '#2f5bd3', html: block, createdAt: now, updatedAt: now, wa: { at: now, html: block } })).id;
    }
    done = true;
    const nbId = target ? target.id : newNbId;
    await db.doc(`users/${uid}/meta/whatsapp`).set({ last: now, count: FieldValue.increment(1), undo: nbId ? { nb: nbId, block, img: imgId || null, isNew: !target, at: now } : null }, { merge: true }).catch(() => {});
    return waSend(m.from, `✅ נכנס ${target ? 'לסוף המחברת' : 'למחברת חדשה'} "${title}"\n${SITE}${target ? '' : '\n\nבפעם הבאה אפשר לכתוב את שם המחברת בכיתוב של התמונה, והיא תיכנס בדיוק לשם.'}`);
  } finally {
    if (!done && !owner) await refundOne(uid, 'ocr');
  }
}

// 🔒 מי מורשה בערוץ המהיר (Realtime Database) של מחברת משותפת.
// הכללים של RTDB לא יכולים לקרוא את Firestore, אז השרת מעתיק לשם את ההרשאות: acl/{share} = { o: בעלים, m: הרשאת הקישור, u: {uid: הרשאה אישית} }
// בלי זה, כל מי שמחובר ויודע את קוד הקישור (גם מי שקיבל רק צפייה, או שהוסר) יכול היה לשלוח תוכן לעורכים ולשנות את המחברת
const { getDatabase } = require('firebase-admin/database');
const RTDB_URL = 'https://my-notebooks-32ffd-default-rtdb.europe-west1.firebasedatabase.app';
const rtdb = () => getDatabase(undefined, RTDB_URL);
const aclMode = m => ['view', 'copy', 'edit', 'none'].includes(m) ? m : 'view';
exports.shareAcl = onDocumentWritten({ document: 'shares/{id}', region: 'europe-west1' }, async ev => {
  const id = ev.params.id, a = ev.data && ev.data.after && ev.data.after.exists ? ev.data.after.data() : null;
  const b = ev.data && ev.data.before && ev.data.before.exists ? ev.data.before.data() : null;
  const ref = rtdb().ref(`acl/${id}`);
  if (!a) { await ref.remove(); return; }
  const m = a.locked === true ? 'none' : aclMode(a.mode);
  if (b && b.owner === a.owner && (b.locked === true ? 'none' : aclMode(b.mode)) === m) {
    const has = await ref.child('o').get(); if (has.exists()) return;   // לא השתנה כלום שקשור להרשאות
  }
  await ref.update({ o: String(a.owner || ''), m });
});
exports.memberAcl = onDocumentWritten({ document: 'shares/{id}/members/{uid}', region: 'europe-west1' }, async ev => {
  const { id, uid } = ev.params;
  const a = ev.data && ev.data.after && ev.data.after.exists ? ev.data.after.data() : null;
  const b = ev.data && ev.data.before && ev.data.before.exists ? ev.data.before.data() : null;
  const ref = rtdb().ref(`acl/${id}/u/${uid}`);
  if (!a) { await ref.remove(); return; }
  if (b && b.mode === a.mode) { const has = await ref.get(); if (has.exists()) return; }   // "מחובר עכשיו" כל דקה – לא נוגעים
  await ref.set(aclMode(a.mode));
});
// מילוי חד-פעמי למחברות שכבר שותפו (רק בעל האתר)
exports.aclBackfill = onCall({ region: 'europe-west1', timeoutSeconds: 300 }, async req => {
  if (!req.auth || !isOwner(req.auth.token)) throw new HttpsError('permission-denied', 'רק לבעל האתר');
  const shares = await db.collection('shares').get(); let n = 0, u = 0;
  for (const s of shares.docs) {
    const a = s.data(); const out = { o: String(a.owner || ''), m: a.locked === true ? 'none' : aclMode(a.mode), u: {} };
    const ms = await s.ref.collection('members').get();
    ms.docs.forEach(d => { out.u[d.id] = aclMode(d.data().mode); u++; });
    await rtdb().ref(`acl/${s.id}`).set(out); n++;
  }
  return { shares: n, members: u };
});
