// 🔒 השרת של ה-AI: כל בקשה ל-Gemini עוברת כאן. השרת בודק מי שואל וכמה הוא כבר שאל היום,
// ורק אז שולח ל-Gemini. לתלמיד אין דרך לשנות את המונה כאן – הוא נשמר ב-aiQuota/{uid},
// ולכללים של Firestore אין שום הרשאה לשם (רק השרת יכול לכתוב).
const { onCall, HttpsError } = require('firebase-functions/v2/https');
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
const MODELS = ['gemini-3.5-flash-lite'];               // המודל של כולם (גם של בעל האתר)
const MAX_BYTES = 24 * 1024 * 1024, MAX_PARTS = 40;
// בעל האתר – בלי הגבלה. כמו באתר: SHA-256 של 'my-notebooks:' + האימייל, כדי שהאימייל לא יופיע בקוד
const UNLIMITED_HASH = ['d480d79943873e56d1e096093086e83c75764b6af1c3d65cd0900a876e2bd622'];
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
  if (['minimal', 'low', 'medium', 'high'].includes(tl)) out.thinkingConfig = { thinkingLevel: tl.toUpperCase() };
  else if (Number.isInteger(tb)) out.thinkingConfig = { thinkingBudget: Math.min(8192, Math.max(0, tb)) };
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
  const { kind, model, cfg, parts, search, image, urls } = req.data || {};
  if (!Object.prototype.hasOwnProperty.call(LIMIT, kind)) throw new HttpsError('invalid-argument', 'bad-kind');
  const owner = isOwner(req.auth.token);
  if (image === true ? kind !== 'img' : (kind === 'img' || !MODELS.includes(model))) throw new HttpsError('invalid-argument', 'bad-model');
  const contents = [{ role: 'user', parts: cleanParts(parts) }];
  const config = cleanConfig(cfg);
  if (!owner) await takeOne(req.auth.uid, kind);
  try { await takeGlobal(kind, owner); } catch (e) { if (!owner) await refundOne(req.auth.uid, kind); throw e; }
  const failed = async () => { if (!owner) await refundOne(req.auth.uid, kind); };

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
      return { t: all, src };
    }
    const r = await ai.models.generateContent({ model, contents, config: cfg2 });
    return { t: r.text || '', f: r.candidates?.[0]?.finishReason || '', b: r.promptFeedback?.blockReason || '', src: sources(r) };
  };
  try {
    // קישורים בהודעה (urls): Gemini נכנס לדפים וקורא אותם. אפשר יחד עם חיפוש ב-Google
    const tools = [...(urls === true ? [{ urlContext: {} }] : []), ...(search === true ? [{ googleSearch: {} }] : [])];
    if (tools.length) { try { return await run({ ...config, tools }); } catch (e) { if (sent) throw e; console.warn('tools failed, trying without', String(e && e.message).slice(0, 200)); } }
    try { return await run(config); }
    catch (e) {
      // המודל לא קיבל thinkingLevel / mediaResolution – מנסים שוב בדרך הישנה
      if (sent || !(config.thinkingConfig?.thinkingLevel || config.mediaResolution)) throw e;
      console.warn('level failed, trying budget', String(e && e.message).slice(0, 200));
      const { mediaResolution, thinkingConfig, ...rest } = config;
      const tb = cfg && cfg.thinkingConfig && cfg.thinkingConfig.thinkingBudget;
      return await run(Number.isInteger(tb) ? { ...rest, thinkingConfig: { thinkingBudget: Math.min(8192, Math.max(0, tb)) } } : rest);
    }
  } catch (e) {
    if (!sent) await failed();
    if (e instanceof HttpsError) throw e;
    const msg = String(e && e.message || e).slice(0, 300);
    console.error('gemini', msg);
    if (/prepayment|credits? (are )?depleted|billing/i.test(msg)) throw new HttpsError('resource-exhausted', 'gemini-credits: ' + msg);
    if (/429|RESOURCE_EXHAUSTED|quota/i.test(msg)) throw new HttpsError('resource-exhausted', 'gemini-quota: ' + msg);
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
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-billing'] });
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
  for (const project of projects) {
    const url = `https://cloudbilling.googleapis.com/v1/projects/${project}/billingInfo`;
    try {
      const cur = await client.request({ url });
      if (!cur.data.billingEnabled) { console.log(`billing already disabled: ${project}`); continue; }
      if (test) { console.log(`TEST ok: ${project} billing=${cur.data.billingEnabled} (can read)`); continue; }
      await client.request({ url, method: 'PUT', data: { billingAccountName: '' } });
      console.error(`BILLING DISABLED for ${project}: cost ${cost} >= budget ${budget}`);
    } catch (e) { console.error(`disable failed for ${project}`, e.message); }
  }
});
