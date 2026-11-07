// 🔒 השרת של ה-AI: כל בקשה ל-Gemini עוברת כאן. השרת בודק מי שואל וכמה הוא כבר שאל היום,
// ורק אז שולח ל-Gemini. לתלמיד אין דרך לשנות את המונה כאן – הוא נשמר ב-aiQuota/{uid},
// ולכללים של Firestore אין שום הרשאה לשם (רק השרת יכול לכתוב).
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp();
const db = getFirestore();
const GEMINI_KEY = defineSecret('GEMINI_API_KEY');

// כמה בקריאות ל-AI מותר ביום לכל סוג. זה קצת יותר מהמכסה שרואים באתר,
// כי פעולה אחת לפעמים צריכה כמה קריאות (ניסיון חוזר, בדיקה כפולה של תמונה).
const LIMIT = { chat: 45, sum: 6, qa: 8, pr: 8, fc: 8, ocr: 14, imp: 30 };
const PER_MINUTE = 10;              // לכל משתמש, כל הסוגים יחד
const MODELS = ['gemini-3.5-flash-lite'];               // המודל של כולם (גם של בעל האתר)
const MAX_BYTES = 24 * 1024 * 1024, MAX_PARTS = 40;
const israelDay = () => Math.floor((Date.now() + 10800000) / 864e5);

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
  const tb = c && c.thinkingConfig && c.thinkingConfig.thinkingBudget;
  if (Number.isInteger(tb)) out.thinkingConfig = { thinkingBudget: Math.min(8192, Math.max(0, tb)) };
  return out;
}

// סופרים קודם, ורק אז שואלים את Gemini. הכול בטרנזקציה, אז גם הרבה בקשות בבת אחת לא עוברות את המכסה.
async function takeOne(uid, kind) {
  const ref = db.doc(`aiQuota/${uid}`);
  await db.runTransaction(async tx => {
    const sn = await tx.get(ref);
    const day = israelDay(), min = Math.floor(Date.now() / 60000);
    let q = sn.exists ? sn.data() : {};
    if (q.day !== day) q = { day, counts: {} };
    const used = (q.counts && q.counts[kind]) || 0;
    if (used >= LIMIT[kind]) throw new HttpsError('resource-exhausted', 'daily-limit');
    const minCount = q.min === min ? (q.minCount || 0) : 0;
    if (minCount >= PER_MINUTE) throw new HttpsError('resource-exhausted', 'minute-limit');
    tx.set(ref, { day, counts: { ...(q.counts || {}), [kind]: used + 1 }, min, minCount: minCount + 1, last: Date.now() });
  });
}

let genai = null;
async function gemini() {
  if (process.env.FAKE_AI === '1') return { models: {
    generateContent: async () => ({ text: 'תשובה לבדיקה' }),
    generateContentStream: async () => (async function* () { yield { text: 'תשובה ' }; yield { text: 'לבדיקה', candidates: [{ finishReason: 'STOP' }] }; })(),
  } };
  if (!genai) { const { GoogleGenAI } = await import('@google/genai'); genai = new GoogleGenAI({ apiKey: GEMINI_KEY.value() }); }
  return genai;
}

exports.ai = onCall({
  region: 'europe-west1', secrets: [GEMINI_KEY], enforceAppCheck: process.env.FAKE_AI !== '1',
  timeoutSeconds: 300, memory: '512MiB', maxInstances: 10, concurrency: 40,
}, async (req, res) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'login');
  const { kind, model, cfg, parts, search } = req.data || {};
  if (!Object.prototype.hasOwnProperty.call(LIMIT, kind)) throw new HttpsError('invalid-argument', 'bad-kind');
  if (!MODELS.includes(model)) throw new HttpsError('invalid-argument', 'bad-model');
  const contents = [{ role: 'user', parts: cleanParts(parts) }];
  const config = cleanConfig(cfg);
  await takeOne(req.auth.uid, kind);   // לכולם, גם לבעל האתר

  const ai = await gemini();
  // חיפוש ב-Google: התשובה מבוססת על אתרים אמיתיים, והם חוזרים כמקורות (src)
  const sources = r => (r.candidates?.[0]?.groundingMetadata?.groundingChunks || []).map(c => c.web).filter(Boolean).map(w => ({ title: String(w.title || '').slice(0, 200), uri: String(w.uri || '').slice(0, 500) }));
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
      return { t: all, src };
    }
    const r = await ai.models.generateContent({ model, contents, config: cfg2 });
    return { t: r.text || '', f: r.candidates?.[0]?.finishReason || '', b: r.promptFeedback?.blockReason || '', src: sources(r) };
  };
  try {
    if (search === true) { try { return await run({ ...config, tools: [{ googleSearch: {} }] }); } catch (e) { if (sent) throw e; console.warn('search failed, trying without', String(e && e.message).slice(0, 200)); } }
    return await run(config);
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    const msg = String(e && e.message || e).slice(0, 300);
    console.error('gemini', msg);
    if (/429|RESOURCE_EXHAUSTED|quota/i.test(msg)) throw new HttpsError('resource-exhausted', 'gemini-quota: ' + msg);
    throw new HttpsError('internal', 'gemini: ' + msg);
  }
});
