import { initializeApp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  updateProfile, sendPasswordResetEmail, GoogleAuthProvider, signInWithPopup, signOut
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";
import {
  getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, addDoc, getDoc, getDocs, increment
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js";
import { getAI, getGenerativeModel, GoogleAIBackend } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-ai.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app-check.js";
import { firebaseConfig, recaptchaSiteKey } from "./firebase-config.js?v=1793615860";
import { SAMPLE_NOTEBOOK } from "./sample-notebook.js";

const $ = id => document.getElementById(id);
const COLORS = ['#2f5bd3','#d24b4b','#2e9e6a','#e08a1e','#7a4fd1','#d1478f','#1f8fa3','#4b5563'];

if (firebaseConfig.apiKey === "PASTE_HERE") {
  $('loginStatus').classList.add('err');
  $('loginStatus').textContent = 'צריך להדביק את הגדרות Firebase בקובץ firebase-config.js (ראה README).';
}

const fb = initializeApp(firebaseConfig);
// App Check: מוכיח ל-Firebase שהבקשות לבינה המלאכותית מגיעות מהאתר שלנו (נדרש לסיכום למבחן)
if (recaptchaSiteKey && !recaptchaSiteKey.startsWith('PASTE')) {
  try { initializeAppCheck(fb, { provider: new ReCaptchaEnterpriseProvider(recaptchaSiteKey), isTokenAutoRefreshEnabled: true }); }
  catch (e) { console.error('App Check', e); }
}
const auth = getAuth(fb);
// שמירה גם במכשיר: המחברות נפתחות גם בלי אינטרנט, ומה שכותבים נשלח כשהחיבור חוזר
let db;
try { db = initializeFirestore(fb, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }); }
catch (e) { console.warn('offline cache', e); db = getFirestore(fb); }
auth.languageCode = 'he';

let me = null, unsub = null, unsubEv = null, notebooks = [], events = [];
let openId = null, dirty = false, saving = false, saveTimer = null, mode = 'login';

/* ================= כניסה / הרשמה ================= */
const ERRORS = {
  'auth/invalid-email': 'כתובת האימייל לא תקינה',
  'auth/missing-password': 'צריך לכתוב סיסמה',
  'auth/weak-password': 'הסיסמה צריכה להיות לפחות 6 תווים',
  'auth/email-already-in-use': 'כבר יש חשבון עם האימייל הזה — נסה "כניסה"',
  'auth/invalid-credential': 'האימייל או הסיסמה לא נכונים',
  'auth/wrong-password': 'הסיסמה לא נכונה',
  'auth/user-not-found': 'אין חשבון עם האימייל הזה — נסה "הרשמה"',
  'auth/too-many-requests': 'יותר מדי ניסיונות. נסה שוב בעוד כמה דקות',
  'auth/popup-closed-by-user': 'חלון ההתחברות נסגר',
  'auth/unauthorized-domain': 'האתר הזה לא מאושר ב-Firebase (Authorized domains — ראה README)',
  'auth/network-request-failed': 'אין חיבור לאינטרנט',
};
const status = (msg, err = true) => { $('loginStatus').textContent = msg; $('loginStatus').classList.toggle('err', err); };
const errMsg = e => ERRORS[e?.code] || 'משהו השתבש, נסה שוב';

function setMode(m) {
  mode = m;
  $('tabLogin').classList.toggle('on', m === 'login');
  $('tabSignup').classList.toggle('on', m === 'signup');
  $('nameField').classList.toggle('hidden', m === 'login');
  $('authBtn').textContent = m === 'login' ? 'כניסה' : 'יצירת חשבון';
  $('password').autocomplete = m === 'login' ? 'current-password' : 'new-password';
  status('');
}
$('tabLogin').onclick = () => setMode('login');
$('tabSignup').onclick = () => setMode('signup');

$('authForm').addEventListener('submit', async e => {
  e.preventDefault();
  const email = $('email').value.trim(), pass = $('password').value;
  $('authBtn').disabled = true; status('');
  try {
    if (mode === 'login') await signInWithEmailAndPassword(auth, email, pass);
    else {
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      const name = $('name').value.trim();
      if (name) { await updateProfile(cred.user, { displayName: name }); showUser(cred.user); }
    }
  } catch (err) { status(errMsg(err)); }
  finally { $('authBtn').disabled = false; }
});

$('googleBtn').onclick = async () => {
  status('');
  try { await signInWithPopup(auth, new GoogleAuthProvider()); }
  catch (err) { status(errMsg(err)); }
};

$('forgotBtn').onclick = async () => {
  const email = $('email').value.trim();
  if (!email) { status('כתוב את האימייל שלך בשדה למעלה ואז לחץ שוב'); return; }
  try { await sendPasswordResetEmail(auth, email); status('שלחנו לך מייל לאיפוס הסיסמה', false); }
  catch (err) { status(errMsg(err)); }
};

$('logoutBtn').onclick = async () => { await flush(); await signOut(auth); };

function showUser(u) {
  const name = u.displayName || u.email || '';
  $('who').textContent = name;
  $('userBtn').textContent = (name.trim()[0] || '?').toUpperCase();
}
$('userBtn').addEventListener('click', e => {
  e.stopPropagation();
  const open = $('userMenu').classList.toggle('hidden') === false;
  $('userBtn').setAttribute('aria-expanded', open);
});
document.addEventListener('click', e => { if (!e.target.closest('.user')) { $('userMenu').classList.add('hidden'); $('userBtn').setAttribute('aria-expanded', 'false'); } });

onAuthStateChanged(auth, user => {
  if (unsub) { unsub(); unsub = null; }
  if (unsubEv) { unsubEv(); unsubEv = null; }
  if (unsubSh) { unsubSh(); unsubSh = null; }
  if (typeof unsubAct !== 'undefined' && unsubAct) { unsubAct(); unsubAct = null; }
  me = user;
  if (shareParam) { openShare(shareParam); }
  if (user) {
    showUser(user);
    $('login').classList.add('hidden'); $('app').classList.remove('hidden');
    $('password').value = '';
    showTab('home'); subscribe(); subscribeEvents(); subscribeShared(); subscribeActivity(); subscribeTimetable();
  } else {
    notebooks = []; events = []; openId = null;
    $('app').classList.add('hidden'); $('login').classList.remove('hidden');
  }
});

/* ================= נתונים ================= */
const nbCol = () => collection(db, 'users', me.uid, 'notebooks');
const nbDoc = id => doc(db, 'users', me.uid, 'notebooks', id);

function subscribe() {
  $('loading').classList.remove('hidden'); $('loading').innerHTML = '<div class="skel-grid">' + '<div class="skel"><i></i><b></b><b></b></div>'.repeat(4) + '</div>';
  $('sample').classList.add('hidden');
  unsub = onSnapshot(query(nbCol(), orderBy('updatedAt', 'desc')), snap => {
    $('loading').classList.add('hidden');
    const allNb = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    notebooks = allNb.filter(n => !n.trashed); trash = allNb.filter(n => n.trashed).sort((a, b) => b.trashed - a.trashed);
    purgeTrash(); renderTrashBtn();
    renderGrid();
    if (!$('home').classList.contains('hidden')) renderHome();
    $('sample').classList.toggle('hidden', notebooks.length > 0);
    if (openId && !notebooks.find(n => n.id === openId)) showLibrary();
  }, err => {
    console.error(err);
    $('loading').textContent = 'לא ניתן לטעון את המחברות. בדוק את כללי האבטחה ב-Firebase (ראה README).';
  });
}

$('sampleBtn').onclick = async () => {
  const now = Date.now();
  await setDoc(doc(nbCol()), { ...SAMPLE_NOTEBOOK, createdAt: now, updatedAt: now });
};

/* ================= עזרים ================= */
const BOX_COLORS = ['yellow', 'blue', 'green', 'purple', 'red', 'gray'];
const LN_RE = /^\d{1,3}\|\d{1,3}\|\d{1,3}\|\d{1,3}\|\d{1,2}\|#[0-9a-fA-F]{6}\|[01]\|[01]$/;
const LINE_RE = /^\d{1,4}\|\d{1,3}\|\d{1,2}\|#[0-9a-fA-F]{6}\|[01]\|[01]$/;
const ALLOWED = new Set(['P','H1','H2','H3','B','STRONG','I','EM','U','MARK','UL','OL','LI','BR','DIV','SPAN','IMG','TABLE','TBODY','THEAD','TR','TD','TH']);
function clean(html) {
  const d = new DOMParser().parseFromString('<div>' + (html || '') + '</div>', 'text/html');
  const walk = node => [...node.childNodes].forEach(ch => {
    if (ch.nodeType === 1) {
      if (!ALLOWED.has(ch.tagName)) {
        if (['SCRIPT','STYLE','IFRAME','OBJECT'].includes(ch.tagName)) { ch.remove(); return; }
        walk(ch); ch.replaceWith(...ch.childNodes); return;
      }
      if (ch.tagName === 'DIV' && ch.hasAttribute('data-box')) {    // תיבת טקסט: שומרים רק את הצבע
        const c = ch.getAttribute('data-box'), bw = ch.getAttribute('data-w'), bh = ch.getAttribute('data-h'), bx = ch.getAttribute('data-x');
        [...ch.attributes].forEach(a => ch.removeAttribute(a.name));
        ch.setAttribute('data-box', BOX_COLORS.includes(c) ? c : 'yellow');
        if (/^\d{2,3}$/.test(bw || '') && +bw >= 15 && +bw <= 100) ch.setAttribute('data-w', bw);
        if (/^\d{2,4}$/.test(bh || '') && +bh >= 40 && +bh <= 3000) ch.setAttribute('data-h', bh);
        if (/^\d{1,2}$/.test(bx || '') && +bx > 0 && +bx <= 85) ch.setAttribute('data-x', bx);
        walk(ch); return;
      }
      if (ch.tagName === 'DIV' && (ch.hasAttribute('data-cv') || ch.hasAttribute('data-ln') || ch.hasAttribute('data-line'))) {   // לוח עיצוב: נשמר רק כ-JSON בדוק
        let cv = null;
        if (ch.hasAttribute('data-cv')) cv = cvParse(ch.getAttribute('data-cv'));
        else {
          let v = ch.getAttribute('data-ln');
          if (!v && LINE_RE.test(ch.getAttribute('data-line') || '')) v = oldLineToLn(ch.getAttribute('data-line'));
          if (v && LN_RE.test(v)) { const q = v.split('|'); cv = cvSan({ h: Math.max(+q[1], +q[3]) + 40, items: [{ t: 'l', x1: +q[0], y1: +q[1], x2: +q[2], y2: +q[3], w: +q[4], c: q[5], d: q[6] === '1', r: q[7] === '1' }] }); }
        }
        if (!cv) { ch.remove(); return; }
        [...ch.attributes].forEach(a => ch.removeAttribute(a.name));
        ch.setAttribute('data-cv', JSON.stringify(cv)); ch.innerHTML = ''; return;
      }
      if (ch.tagName === 'DIV' && ch.hasAttribute('data-file')) {   // קובץ מצורף: רק מזהה, שם וגודל
        const id = ch.getAttribute('data-file'), nm = (ch.getAttribute('data-name') || 'קובץ').slice(0, 120), sz = ch.getAttribute('data-size');
        if (!/^[\w-]{1,64}$/.test(id || '')) { ch.remove(); return; }
        [...ch.attributes].forEach(a => ch.removeAttribute(a.name));
        ch.setAttribute('data-file', id); ch.setAttribute('data-name', nm); if (/^\d{1,9}$/.test(sz || '')) ch.setAttribute('data-size', sz);
        ch.innerHTML = ''; return;
      }
      if (ch.tagName === 'IMG') {                     // תמונה נשמרת רק עם המזהה שלה
        const id = ch.getAttribute('data-img');
        if (!id || !/^[\w-]+$/.test(id)) { ch.remove(); return; }
        [...ch.attributes].forEach(a => ch.removeAttribute(a.name));
        ch.setAttribute('data-img', id); return;
      }
      const isTl = ch.tagName === 'OL' && ch.classList.contains('tl');
      const al = ch.getAttribute('data-a');
      [...ch.attributes].forEach(a => ch.removeAttribute(a.name));
      if (isTl) ch.className = 'tl';
      if ((al === 'center' || al === 'left') && /^(P|H1|H2|H3|LI)$/.test(ch.tagName)) ch.setAttribute('data-a', al);   // יישור
      walk(ch);
    } else if (ch.nodeType !== 3) ch.remove();
  });
  const root = d.body.firstChild; walk(root); return root.innerHTML;
}
function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2600); }
function fmtDate(ms) { try { return ms ? new Date(ms).toLocaleDateString('he-IL', { day: 'numeric', month: 'long' }) : ''; } catch { return ''; } }
function closeDialog() { $('dialogRoot').innerHTML = ''; }
function dialog(build) {
  const o = document.createElement('div'); o.className = 'overlay';
  o.addEventListener('click', e => { if (e.target === o) closeDialog(); });
  const d = document.createElement('div'); d.className = 'dialog'; o.appendChild(d);
  build(d); $('dialogRoot').innerHTML = ''; $('dialogRoot').appendChild(o);
}

/* ================= מסכים ================= */
function timeAgo(ms) {
  if (!ms) return '';
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'עכשיו';
  if (m < 60) return m === 1 ? 'לפני דקה' : `לפני ${m} דקות`;
  const h = Math.round(m / 60); if (h < 24) return h === 1 ? 'לפני שעה' : `לפני ${h} שעות`;
  const d = Math.round(h / 24); if (d < 7) return d === 1 ? 'אתמול' : `לפני ${d} ימים`;
  return fmtDate(ms);
}
function preview(html) { const t = document.createElement('div'); t.innerHTML = (html || '').replace(/<\/(p|h1|h2|h3|li|div|td|th)>/gi, ' $&').replace(/<br\s*\/?>/gi, ' '); return t.textContent.replace(/\s+/g, ' ').trim().slice(0, 90); }
function nbCard(n, i) {
  const b = document.createElement('button'); b.className = 'nb'; b.style.setProperty('--c', n.color || COLORS[0]); b.style.setProperty('--i', i);
  const cover = document.createElement('div'); cover.className = 'nb-cover';
  const letter = document.createElement('span'); letter.className = 'nb-letter'; letter.textContent = (n.title || '?').trim()[0] || '?';
  cover.appendChild(letter);
  const body = document.createElement('div'); body.className = 'nb-body';
  const l = document.createElement('div'); l.className = 'label'; l.textContent = n.title || 'מחברת ללא שם';
  const pv = document.createElement('div'); pv.className = 'nb-pv'; pv.textContent = preview(n.html) || 'מחברת ריקה';
  const m = document.createElement('div'); m.className = 'meta'; m.textContent = n.updatedAt ? 'עודכן ' + timeAgo(n.updatedAt) : '';
  body.append(l, pv, m); b.append(cover, body);
  b.onclick = () => openNotebook(n.id);
  return b;
}
function renderGrid() {
  const g = $('grid'); g.innerHTML = '';
  notebooks.forEach((n, i) => g.appendChild(nbCard(n, i)));
  const add = document.createElement('button'); add.className = 'nb new'; add.style.setProperty('--i', notebooks.length);
  add.innerHTML = '<svg><use href="#i-plus"/></svg><span>מחברת חדשה</span>';
  add.onclick = newNotebook; g.appendChild(add);
  $('count').textContent = notebooks.length === 1 ? 'מחברת אחת' : notebooks.length ? `${notebooks.length} מחברות` : '';
  renderSide();
}
function renderSide() {
  const box = $('sideList'); if (!box) return; box.innerHTML = '';
  notebooks.forEach(n => {
    const b = document.createElement('button'); b.className = 'side-nb' + (n.id === openId ? ' on' : '');
    const dot = document.createElement('i'); dot.style.background = n.color || COLORS[0];
    const t = document.createElement('span'); t.textContent = n.title || 'מחברת ללא שם';
    b.append(dot, t); b.onclick = () => openNotebook(n.id); box.appendChild(b);
  });
}
const VIEWS = ['home', 'library', 'notebook', 'calendar'];
const TAB_OF = { home: 'home', library: 'notes', notebook: 'notes', calendar: 'cal' };
function setView(v, crumb) {
  VIEWS.forEach(x => { const el = $(x); const on = x === v; el.classList.toggle('hidden', !on); if (on) { el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter'); } });
  document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === TAB_OF[v]));
  $('crumb').textContent = crumb || { home: 'בית', library: 'מחברות', calendar: 'יומן' }[v] || '';
  document.body.dataset.view = v;
  window.scrollTo(0, 0);
}
function showLibrary() {
  openId = null; setView('library'); renderGrid();
}
function openNotebook(id) {
  const n = notebooks.find(x => x.id === id); if (!n) return;
  if (openId && openId !== id) flush();
  openId = id; dirty = false;
  $('title').value = n.title || '';
  $('docColor').style.setProperty('--c', n.color || COLORS[0]);
  $('editor').innerHTML = clean(n.html || '');
  loadImages($('editor'));
  renderFiles($('editor'));
  renderCanvases($('editor'));
  applyBoxSizes($('editor'));
  setSave('נשמר בענן', 'ok');
  setView('notebook', 'מחברות › ' + (n.title || ''));
  renderSide();
}
$('backBtn').onclick = async () => { await flush(); showLibrary(); };
$('newBtn').onclick = () => newNotebook();

function newNotebook() {
  let color = COLORS[notebooks.length % COLORS.length];
  dialog(d => {
    d.innerHTML = '<h3>מחברת חדשה</h3><p>איך לקרוא למחברת?</p>';
    const inp = document.createElement('input'); inp.placeholder = 'למשל: מחברת היסטוריה';
    const pick = document.createElement('div'); pick.className = 'picker';
    COLORS.forEach(c => {
      const s = document.createElement('button'); s.style.background = c; if (c === color) s.classList.add('on');
      s.onclick = () => { color = c; [...pick.children].forEach(x => x.classList.remove('on')); s.classList.add('on'); };
      pick.appendChild(s);
    });
    const row = document.createElement('div'); row.className = 'row';
    const ok = document.createElement('button'); ok.className = 'btn btn-primary'; ok.textContent = 'יצירה';
    const cancel = document.createElement('button'); cancel.className = 'btn btn-ghost'; cancel.textContent = 'ביטול'; cancel.onclick = closeDialog;
    const go = async () => {
      ok.disabled = true;
      try {
        const ref = doc(nbCol()); const now = Date.now();
        await setDoc(ref, { title: inp.value.trim() || 'מחברת חדשה', color, html: '', createdAt: now, updatedAt: now });
        closeDialog();
        const wait = () => notebooks.find(x => x.id === ref.id) ? openNotebook(ref.id) : setTimeout(wait, 100);
        wait();
      } catch (e) { ok.disabled = false; toast('לא הצלחתי ליצור את המחברת'); }
    };
    ok.onclick = go; inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    row.append(ok, cancel); d.append(inp, pick, row); setTimeout(() => inp.focus(), 30);
  });
}

$('delBtn').onclick = () => {
  const n = notebooks.find(x => x.id === openId); if (!n) return;
  dialog(d => {
    d.innerHTML = '<h3>להעביר לפח?</h3>';
    const p = document.createElement('p'); p.textContent = `"${n.title}" תעבור לפח המחזור. אפשר להחזיר אותה במשך 30 יום${n.shareId ? ', אבל קישור השיתוף שלה יבוטל' : ''}.`;
    const row = document.createElement('div'); row.className = 'row';
    const ok = document.createElement('button'); ok.className = 'btn btn-danger'; ok.textContent = 'העברה לפח';
    const cancel = document.createElement('button'); cancel.className = 'btn btn-ghost'; cancel.textContent = 'ביטול'; cancel.onclick = closeDialog;
    ok.onclick = async () => {
      ok.disabled = true; clearTimeout(saveTimer); dirty = false;
      try {
        if (n.shareId) await deleteDoc(shareDoc(n.shareId)).catch(() => {});
        await updateDoc(nbDoc(n.id), { trashed: Date.now(), shareId: null });
        closeDialog(); showLibrary(); toast('המחברת הועברה לפח');
      }
      catch (e) { ok.disabled = false; toast('המחיקה נכשלה'); }
    };
    row.append(ok, cancel); d.append(p, row);
  });
};

/* ================= שמירה אוטומטית ================= */
function markDirty() { dirty = true; setSave('שומר...', 'busy'); clearTimeout(saveTimer); saveTimer = setTimeout(flush, 1200); }
const setSave = (txt, st) => { const el = $('save'); el.textContent = txt; el.dataset.st = st || ''; };
async function flush() {
  clearTimeout(saveTimer);
  if (!dirty || !openId || !me) return;
  if (saving) { saveTimer = setTimeout(flush, 400); return; }
  saving = true; dirty = false;
  const id = openId;
  // בלי אינטרנט Firebase שומר במכשיר מיד, אבל לא מאשר עד שהחיבור חוזר: לא מחכים לו
  const fields = { title: $('title').value.trim() || 'מחברת ללא שם', html: clean($('editor').innerHTML), updatedAt: Date.now() };
  const nbw = notebooks.find(x => x.id === id); if (nbw) fields.words = trackWords(nbw, fields.html);
  const pr = updateDoc(nbDoc(id), fields);
  const nbx = notebooks.find(x => x.id === id);
  if (nbx && nbx.shareId) updateDoc(shareDoc(nbx.shareId), { ...fields, color: nbx.color || COLORS[0] }).catch(e => console.warn('share sync', e));
  const done = () => { if (openId === id && !dirty) setSave(navigator.onLine ? 'נשמר בענן' : 'נשמר במכשיר · יסונכרן', navigator.onLine ? 'ok' : 'off'); };
  pr.then(() => { if (openId === id && !dirty) setSave('נשמר בענן', 'ok'); }).catch(e => { console.error(e); dirty = true; setSave('לא נשמר · מנסה שוב', 'err'); saveTimer = setTimeout(flush, 3000); });
  try { await Promise.race([pr, new Promise(r => setTimeout(r, navigator.onLine ? 4000 : 300))]); done(); } catch {}
  finally { saving = false; }
}
$('editor').addEventListener('input', markDirty);
$('title').addEventListener('input', () => { markDirty(); const n = notebooks.find(x => x.id === openId); const el = document.querySelector('.side-nb.on span'); if (el) el.textContent = $('title').value; $('crumb').textContent = 'מחברות › ' + $('title').value; });
window.addEventListener('beforeunload', e => { if (dirty) { flush(); e.preventDefault(); e.returnValue = ''; } });

/* ================= סרגל עיצוב ================= */
// שומרים את המיקום של הסמן כדי שלחיצה על כפתור (גם בטלפון) לא תאבד אותו
let savedRange = null;
document.addEventListener('selectionchange', () => {
  const s = window.getSelection();
  if (s.rangeCount && $('editor').contains(s.anchorNode) && !(s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement).closest('.cv')) savedRange = s.getRangeAt(0).cloneRange();
});
function restoreSelection() {
  const ed = $('editor');
  ed.focus({ preventScroll: true });
  const s = window.getSelection();
  if (savedRange && ed.contains(savedRange.startContainer)) { s.removeAllRanges(); s.addRange(savedRange); }
  else { const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); s.removeAllRanges(); s.addRange(r); }
}
// עוטפים טקסט "חופשי" (שלא בתוך פסקה) בפסקאות, כדי שיהיה אפשר לשנות אותו
const BLOCK_RE = /^(P|H1|H2|H3|LI|DIV)$/;
const INLINE = ['B','STRONG','I','EM','U','MARK','SPAN','BR'];
function wrapLoose() {
  const ed = $('editor');
  // DIV שמכיל בתוכו שורות — מוציאים את השורות החוצה
  ed.querySelectorAll(':scope > div').forEach(d => {
    if ([...d.children].some(c => BLOCK_RE.test(c.tagName) || c.tagName === 'UL' || c.tagName === 'OL')) d.replaceWith(...d.childNodes);
  });
  let group = [];
  const flush = () => {
    if (!group.length) return;
    if (group.every(n => n.nodeType === 3 && !n.textContent.trim())) { group = []; return; }
    const p = document.createElement('p'); group[0].before(p); group.forEach(n => p.appendChild(n)); group = [];
  };
  [...ed.childNodes].forEach(n => {
    const inline = n.nodeType === 3 || (n.nodeType === 1 && INLINE.includes(n.tagName));
    if (inline) group.push(n); else flush();
  });
  flush();
}
function blockOf(node) {
  const ed = $('editor');
  let n = node && (node.nodeType === 1 ? node : node.parentElement);
  while (n && n !== ed) { if (BLOCK_RE.test(n.tagName)) return n; n = n.parentElement; }
  return null;
}
const isEmpty = el => !el.textContent.replace(/​/g, '').trim();
function placeCaret(el) {
  const s = window.getSelection(); const r = document.createRange();
  r.setStart(el, 0); r.collapse(true); s.removeAllRanges(); s.addRange(r);
}
function newBlock(tag, frag) {
  const el = document.createElement(tag);
  if (frag) el.appendChild(frag);
  if (!el.firstChild || isEmpty(el) && !el.querySelector('br')) { el.innerHTML = ''; el.appendChild(document.createElement('br')); }
  return el;
}

// כותרת / כותרת משנה / כותרת קטנה / טקסט
// • אם סימנת טקסט — רק מה שסימנת משתנה
// • אם לא סימנת כלום — מה שתכתוב מעכשיו ייכתב בסגנון שבחרת
function setBlock(tag) {
  restoreSelection();
  { const s0 = window.getSelection(); const n0 = s0.rangeCount && s0.getRangeAt(0).startContainer;
    const el0 = n0 && (n0.nodeType === 1 ? n0 : n0.parentElement);
    if (el0 && el0.closest('#editor td, #editor th')) { toast('בתוך טבלה אפשר להשתמש במודגש ובמרקר'); return; } }
  const ed = $('editor'); const s = window.getSelection();
  const r0 = s.rangeCount ? s.getRangeAt(0) : null;
  const pos = r0 && [r0.startContainer, r0.startOffset, r0.endContainer, r0.endOffset];
  wrapLoose();
  let r = null;
  if (pos) { try { r = document.createRange(); r.setStart(pos[0], pos[1]); r.setEnd(pos[2], pos[3]); } catch { r = null; } }

  /* ---- בלי סימון: מכינים שורה חדשה בסגנון שנבחר ---- */
  if (!r || r.collapsed) {
    const B = r && blockOf(r.startContainer);
    if (!B) { const el = newBlock(tag); ed.appendChild(el); placeCaret(el); return; }
    if (isEmpty(B) && B.tagName !== 'LI') {           // שורה ריקה — פשוט משנים אותה
      const el = newBlock(tag); B.replaceWith(el); placeCaret(el); return;
    }
    if (B.tagName === 'LI') {                         // בתוך רשימה — שורה חדשה אחרי הרשימה
      const list = B.closest('ul,ol') || B; const el = newBlock(tag); list.after(el); placeCaret(el); return;
    }
    // מפצלים את השורה במקום של הסמן
    const tail = document.createRange(); tail.setStart(r.startContainer, r.startOffset); tail.setEnd(B, B.childNodes.length);
    const afterFrag = tail.extractContents();
    const el = newBlock(tag);
    B.after(el);
    const restDiv = document.createElement('div'); restDiv.appendChild(afterFrag.cloneNode(true));
    if (!isEmpty(restDiv)) { const rest = document.createElement(B.tagName.toLowerCase()); rest.appendChild(afterFrag); el.after(rest); }
    if (isEmpty(B)) B.remove();
    placeCaret(el); return;
  }

  /* ---- עם סימון: משנים רק את מה שסומן ---- */
  const leaves = [...ed.querySelectorAll('p,h1,h2,h3,li,div')]
    .filter(el => ![...el.querySelectorAll('p,h1,h2,h3,li,div')].length && r.intersectsNode(el));
  if (!leaves.length) return;
  const target = (tag !== 'p' && leaves.every(el => el.tagName === tag.toUpperCase())) ? 'p' : tag; // לחיצה שנייה מחזירה לטקסט
  const parts = leaves.map(b => ({
    b,
    s: b.contains(r.startContainer) ? [r.startContainer, r.startOffset] : [b, 0],
    e: b.contains(r.endContainer) ? [r.endContainer, r.endOffset] : [b, b.childNodes.length],
  }));
  const made = [];
  parts.reverse().forEach(({ b, s: st, e: en }) => {
    const afterR = document.createRange(); afterR.setStart(en[0], en[1]); afterR.setEnd(b, b.childNodes.length);
    const afterFrag = afterR.extractContents();
    const midR = document.createRange(); midR.setStart(st[0], st[1]); midR.setEnd(b, b.childNodes.length);
    const midFrag = midR.extractContents();
    const tmp = document.createElement('div'); tmp.appendChild(midFrag.cloneNode(true));
    if (isEmpty(tmp)) { b.appendChild(midFrag); b.appendChild(afterFrag); return; }
    if (b.tagName === 'LI') {                          // בתוך רשימה: הכותרת נשארת בתוך אותה שורה
      const el = target === 'p' ? null : document.createElement(target);
      if (el) { el.appendChild(midFrag); b.appendChild(el); made.unshift(el); } else { b.appendChild(midFrag); }
      b.appendChild(afterFrag); return;
    }
    const mid = document.createElement(target); mid.appendChild(midFrag);
    mid.querySelectorAll('h1,h2,h3').forEach(h => h.replaceWith(...h.childNodes));
    b.after(mid); made.unshift(mid);
    const t2 = document.createElement('div'); t2.appendChild(afterFrag.cloneNode(true));
    if (!isEmpty(t2)) { const rest = document.createElement(b.tagName.toLowerCase()); rest.appendChild(afterFrag); mid.after(rest); }
    if (isEmpty(b)) b.remove();
  });
  if (made.length) {
    const nr = document.createRange(); nr.setStart(made[0], 0); nr.setEnd(made[made.length - 1], made[made.length - 1].childNodes.length);
    s.removeAllRanges(); s.addRange(nr);
  }
}

const tb = $('toolbar');
try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch {}
['mousedown', 'pointerdown'].forEach(ev =>
  tb.addEventListener(ev, e => { if (e.target.closest('button')) e.preventDefault(); }, { passive: false }));
tb.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || !b.dataset.cmd) return;
  const c = b.dataset.cmd;
  if (['h1','h2','h3','p'].includes(c)) { setBlock(c); markDirty(); return; }
  restoreSelection();
  if (c === 'ul') document.execCommand('insertUnorderedList');
  else if (c === 'ol') document.execCommand('insertOrderedList');
  else if (c === 'mark') {
    const sel = window.getSelection(); if (!sel.rangeCount || sel.isCollapsed) { toast('קודם מסמנים את המילים שרוצים להדגיש'); return; }
    const anc = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
    const m = anc && anc.closest('mark');
    if (m) m.replaceWith(...m.childNodes);
    else { const r = sel.getRangeAt(0); const mk = document.createElement('mark'); try { r.surroundContents(mk); } catch { mk.appendChild(r.extractContents()); r.insertNode(mk); } }
  }
  else document.execCommand(c);
  markDirty();
});
$('editor').addEventListener('paste', e => {
  e.preventDefault();
  const files = [...(e.clipboardData.files || [])].filter(f => f.type.startsWith('image/'));
  if (files.length) { addImages(files); return; }
  const html = e.clipboardData.getData('text/html');
  if (html) document.execCommand('insertHTML', false, clean(html));
  else document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
});


/* ================= ניווט ================= */
function showTab(t) {
  flush();
  if (t === 'cal') { openId = null; setView('calendar'); renderCalendar(); renderSide(); }
  else if (t === 'notes') showLibrary();
  else { openId = null; setView('home'); renderHome(); renderSide(); }
}
document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
$('sideNew').onclick = () => newNotebook();
$('homeNew').onclick = () => newNotebook();
$('homeCal').onclick = () => showTab('cal');

/* ================= יומן ================= */
const HE_MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
const HE_DAYS = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
const TYPE_NAME = { test: 'מבחן', hw: 'שיעורי בית', event: 'אירוע', other: 'אחר' };
const pad = n => String(n).padStart(2, '0');
const key = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const todayKey = () => key(new Date());
let viewMonth = new Date(); viewMonth.setDate(1);
let selDay = todayKey();

const evCol = () => collection(db, 'users', me.uid, 'events');
const evDoc = id => doc(db, 'users', me.uid, 'events', id);

function subscribeEvents() {
  unsubEv = onSnapshot(evCol(), snap => {
    events = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.date + (a.time || '99')).localeCompare(b.date + (b.time || '99')));
    if (!$('calendar').classList.contains('hidden')) renderCalendar();
    if (!$('home').classList.contains('hidden')) renderHome();
    remind();
  }, err => console.error(err));
}

let hiddenTypes = new Set(); try { hiddenTypes = new Set(JSON.parse(localStorage.getItem('hiddenTypes') || '[]')); } catch {}
const shown = e => !hiddenTypes.has(e.type || 'other');
function renderLegend() {
  const L = document.querySelector('#calendar .legend'); if (!L) return;
  L.innerHTML = '<span class="lbl">הצג:</span>' + [['test', 'מבחנים'], ['hw', 'שיעורי בית'], ['event', 'אירועים'], ['other', 'אחר']].map(([t, n]) =>
    `<button type="button" class="flt${hiddenTypes.has(t) ? '' : ' on'}" data-t="${t}" aria-pressed="${!hiddenTypes.has(t)}"><i class="dot t-${t}"></i>${n}</button>`).join('')
    + (hiddenTypes.size ? '<button type="button" class="flt all" data-t="all">הצג הכל</button>' : '');
}
document.querySelector('#calendar .legend').addEventListener('click', e => {
  const b = e.target.closest('.flt'); if (!b) return;
  const t = b.dataset.t;
  if (t === 'all') hiddenTypes.clear();
  else if (hiddenTypes.has(t)) hiddenTypes.delete(t);
  else { hiddenTypes.add(t); if (hiddenTypes.size === 4) hiddenTypes.delete(t); }
  try { localStorage.setItem('hiddenTypes', JSON.stringify([...hiddenTypes])); } catch {}
  renderCalendar();
});
function renderCalendar() {
  renderLegend();
  $('monthTitle').textContent = `${HE_MONTHS[viewMonth.getMonth()]} ${viewMonth.getFullYear()}`;
  const g = $('calGrid'); g.innerHTML = '';
  const start = new Date(viewMonth); start.setDate(1 - start.getDay());
  const byDay = {};
  events.filter(shown).forEach(e => (byDay[e.date] ||= []).push(e));
  const tk = todayKey();
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    if (i === 35 && d.getMonth() !== viewMonth.getMonth()) break;
    const k = key(d);
    const c = document.createElement('button'); c.className = 'cell';
    if (d.getMonth() !== viewMonth.getMonth()) c.classList.add('out');
    if (k === tk) c.classList.add('today');
    if (k === selDay) c.classList.add('sel');
    const n = document.createElement('span'); n.className = 'num'; n.textContent = d.getDate(); c.appendChild(n);
    const list = byDay[k] || [];
    if (list.length) {
      c.classList.add('has-ev');
      if (list.some(e => e.type === 'test' && !e.done)) c.classList.add('has-test');
      const row = document.createElement('span'); row.className = 'chips-row';
      list.slice(0, 3).forEach(e => {
        const ch = document.createElement('span'); ch.className = `chip t-${e.type || 'other'}` + (e.done ? ' done' : '');
        ch.textContent = e.title; row.appendChild(ch);
      });
      if (list.length > 3) { const m = document.createElement('span'); m.className = 'more'; m.textContent = `+${list.length - 3}`; row.appendChild(m); }
      c.appendChild(row);
      c.setAttribute('aria-label', `${d.getDate()} – ${list.length === 1 ? 'אירוע אחד' : list.length + ' אירועים'}`);
    }
    c.onclick = () => { selDay = k; renderCalendar(); };
    g.appendChild(c);
  }
  renderDay(); renderUpcoming();
}

function evRow(e, showDate) {
  const r = document.createElement('div'); r.className = 'ev' + (e.done ? ' done' : '');
  const bar = document.createElement('span'); bar.className = `bar-c t-${e.type || 'other'}`;
  const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!e.done; cb.title = 'סיימתי';
  cb.onchange = () => updateDoc(evDoc(e.id), { done: cb.checked }).catch(() => toast('לא נשמר'));
  const t = document.createElement('div'); t.className = 't';
  const sp = document.createElement('span'); sp.textContent = e.title;
  const sm = document.createElement('small');
  const d = fromKey(e.date);
  const nf = (e.files || []).length;
  sm.textContent = [TYPE_NAME[e.type] || 'אחר', e.time, showDate ? `יום ${HE_DAYS[d.getDay()]}, ${d.getDate()} ב${HE_MONTHS[d.getMonth()]}` : '', nf ? `📎 ${nf === 1 ? 'קובץ' : nf + ' קבצים'}` : ''].filter(Boolean).join(' · ');
  t.append(sp, sm);
  if (e.note) { const nt = document.createElement('small'); nt.className = 'ev-note'; nt.textContent = e.note; t.appendChild(nt); }
  t.style.cursor = 'pointer'; t.title = 'פרטים, הערות וקבצים'; t.onclick = () => eventDialog(e.id);
  const x = document.createElement('button'); x.className = 'x'; x.textContent = '✕'; x.title = 'מחיקה';
  x.onclick = () => deleteDoc(evDoc(e.id)).catch(() => toast('המחיקה נכשלה'));
  r.append(bar, cb, t, x); return r;
}

function renderDay() {
  const d = fromKey(selDay);
  $('dayTitle').textContent = (selDay === todayKey() ? 'היום · ' : '') + `יום ${HE_DAYS[d.getDay()]}, ${d.getDate()} ב${HE_MONTHS[d.getMonth()]}`;
  const box = $('dayList'); box.innerHTML = '';
  const list = events.filter(e => e.date === selDay && shown(e));
  if (!list.length) { const p = document.createElement('div'); p.className = 'noev'; p.textContent = 'אין כלום ביום הזה.'; box.appendChild(p); }
  list.forEach(e => box.appendChild(evRow(e, false)));
}

function renderUpcoming() {
  const box = $('upcoming'); box.innerHTML = '';
  const tk = todayKey();
  const list = events.filter(e => e.date >= tk && !e.done && shown(e)).slice(0, 6);
  if (!list.length) { const p = document.createElement('div'); p.className = 'noev'; p.textContent = 'אין משימות פתוחות 🎉'; box.appendChild(p); }
  list.forEach(e => box.appendChild(evRow(e, true)));
}

$('evForm').addEventListener('submit', async e => {
  e.preventDefault();
  const raw = $('evTitle').value.trim(); if (!raw) return;
  const q = parseQuick(raw);    // "מחר", "ביום חמישי" וכו' בתוך הטקסט מנצחים את היום שבחרת
  try {
    await addDoc(evCol(), { title: q.title, type: q.typeFound ? q.type : $('evType').value, time: $('evTime').value || q.time || '', date: q.dateFound ? q.date : selDay, done: false, createdAt: Date.now() });
    if (q.dateFound && q.date !== selDay) toast(`נוסף ל${q.dateLabel}`);
    $('evTitle').value = ''; $('evTime').value = '';
  } catch (err) { toast('לא הצלחתי להוסיף'); }
});
$('prevMonth').onclick = () => { viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1); renderCalendar(); };
$('nextMonth').onclick = () => { viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1); renderCalendar(); };
$('todayBtn').onclick = () => { const n = new Date(); viewMonth = new Date(n.getFullYear(), n.getMonth(), 1); selDay = todayKey(); renderCalendar(); };


/* ================= תמונות ================= */
// כל תמונה נשמרת כמסמך נפרד (users/<uid>/images/<id>), ובמחברת נשמר רק המזהה שלה
const imgCache = new Map();
const imgDoc = (id, uid) => doc(db, 'users', uid || me.uid, 'images', id);

async function loadImages(root, uid) {
  root.querySelectorAll('img[data-img]').forEach(async img => {
    const id = img.getAttribute('data-img');
    if (imgCache.has(id)) { img.src = imgCache.get(id); return; }
    img.classList.add('loading-img');
    try {
      const snap = await getDoc(imgDoc(id, uid));
      if (snap.exists()) { imgCache.set(id, snap.data().data); img.src = snap.data().data; }
      else img.alt = 'התמונה לא נמצאה';
    } catch { img.alt = 'לא הצלחתי לטעון את התמונה'; }
    img.classList.remove('loading-img');
  });
}

// מקטינים את התמונה כדי שתישמר מהר ותיכנס במגבלת הגודל
function shrink(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file); const im = new Image();
    im.onload = () => {
      let max = 1400, q = 0.8, out;
      for (let i = 0; i < 6; i++) {
        const k = Math.min(1, max / Math.max(im.width, im.height));
        const c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height);
        out = c.toDataURL('image/jpeg', q);
        if (out.length < 900000) break;
        max = Math.round(max * 0.8); q = Math.max(0.5, q - 0.08);
      }
      URL.revokeObjectURL(url); res(out);
    };
    im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('bad image')); };
    im.src = url;
  });
}

async function addImages(files) {
  const list = [...files].filter(f => f.type.startsWith('image/'));
  if (!list.length || !openId) return;
  restoreSelection();
  for (const f of list) {
    const holder = document.createElement('p'); holder.className = 'img-uploading'; holder.textContent = '⏳ מעלה תמונה...';
    insertBlockAtCaret(holder);
    try {
      const data = await shrink(f);
      const ref = doc(collection(db, 'users', me.uid, 'images'));
      await setDoc(ref, { data, createdAt: Date.now() });
      imgCache.set(ref.id, data);
      const p = document.createElement('p'); const img = document.createElement('img');
      img.setAttribute('data-img', ref.id); img.src = data; p.appendChild(img);
      const after = document.createElement('p'); after.appendChild(document.createElement('br'));
      holder.replaceWith(p); p.after(after); placeCaret(after);
      markDirty();
    } catch (e) {
      holder.remove(); toast('לא הצלחתי להעלות את התמונה');
    }
  }
}

function insertBlockAtCaret(el) {
  const ed = $('editor'); const s = window.getSelection();
  const r = s.rangeCount ? s.getRangeAt(0) : null;
  const B = r && ed.contains(r.startContainer) && blockOf(r.startContainer);
  if (!B) { ed.appendChild(el); return; }
  const top = B.closest('ul,ol') && B.tagName === 'LI' ? B.closest('ul,ol') : B;
  if (isEmpty(B) && top === B) B.replaceWith(el); else top.after(el);
}

$('imgBtn').addEventListener('click', () => { restoreSelection(); $('imgInput').click(); });
$('imgInput').addEventListener('change', e => { addImages(e.target.files); e.target.value = ''; });
$('editor').addEventListener('drop', e => {
  if (e.dataTransfer && [...e.dataTransfer.files].some(f => f.type.startsWith('image/'))) { e.preventDefault(); addImages(e.dataTransfer.files); }
});
$('editor').addEventListener('click', e => {
  const img = e.target.closest('img'); if (!img || !img.src) return;
  dialog(d => {
    d.classList.add('img-view');
    const big = document.createElement('img'); big.src = img.src;
    const row = document.createElement('div'); row.className = 'row';
    const del = document.createElement('button'); del.className = 'btn btn-danger'; del.textContent = 'מחיקת התמונה';
    del.onclick = () => { const id = img.getAttribute('data-img'); const p = img.closest('p');
      img.remove(); if (p && isEmpty(p) && !p.querySelector('img')) p.remove();
      if (id) deleteDoc(imgDoc(id)).catch(() => {}); markDirty(); closeDialog(); };
    const close = document.createElement('button'); close.className = 'btn btn-ghost'; close.textContent = 'סגירה'; close.onclick = closeDialog;
    row.append(del, close); d.append(big, row);
  });
});


/* ================= טבלאות ================= */
function caretCell() {
  const s = window.getSelection(); if (!s.rangeCount) return null;
  const n = s.getRangeAt(0).startContainer; const el = n.nodeType === 1 ? n : n.parentElement;
  return el && $('editor').contains(el) ? el.closest('td,th') : null;
}
function makeTable(rows, cols, header) {
  const t = document.createElement('table'); const tb = document.createElement('tbody'); t.appendChild(tb);
  for (let r = 0; r < rows; r++) {
    const tr = document.createElement('tr');
    for (let c = 0; c < cols; c++) { const td = document.createElement(header && r === 0 ? 'th' : 'td'); td.appendChild(document.createElement('br')); tr.appendChild(td); }
    tb.appendChild(tr);
  }
  return t;
}
function insertTable(rows, cols, header) {
  restoreSelection();
  const t = makeTable(rows, cols, header);
  insertBlockAtCaret(t);
  const after = document.createElement('p'); after.appendChild(document.createElement('br')); t.after(after);
  placeCaret(t.querySelector('td,th'));
  markDirty();
}
const rowOf = cell => cell.parentElement;
const tableOf = cell => cell.closest('table');
const colIndex = cell => [...rowOf(cell).children].indexOf(cell);
function tableAction(act, cell) {
  const tr = rowOf(cell), t = tableOf(cell), ci = colIndex(cell);
  const rows = [...t.querySelectorAll('tr')];
  const newCell = tag => { const c = document.createElement(tag); c.appendChild(document.createElement('br')); return c; };
  if (act === 'rowAfter' || act === 'rowBefore') {
    const nr = document.createElement('tr'); [...tr.children].forEach(() => nr.appendChild(newCell('td')));
    act === 'rowAfter' ? tr.after(nr) : tr.before(nr); placeCaret(nr.children[ci] || nr.firstChild);
  } else if (act === 'colAfter' || act === 'colBefore') {
    rows.forEach(r => { const ref = r.children[ci]; const c = newCell(r.firstElementChild && r.firstElementChild.tagName === 'TH' ? 'th' : 'td');
      if (!ref) r.appendChild(c); else act === 'colAfter' ? ref.after(c) : ref.before(c); });
    placeCaret(tr.children[act === 'colAfter' ? ci + 1 : ci]);
  } else if (act === 'delRow') {
    if (rows.length <= 1) return tableAction('delTable', cell);
    const next = tr.nextElementSibling || tr.previousElementSibling; tr.remove(); placeCaret(next.children[Math.min(ci, next.children.length - 1)]);
  } else if (act === 'delCol') {
    if (tr.children.length <= 1) return tableAction('delTable', cell);
    rows.forEach(r => r.children[ci] && r.children[ci].remove()); placeCaret(tr.children[Math.max(0, ci - 1)]);
  } else if (act === 'delTable') {
    const p = document.createElement('p'); p.appendChild(document.createElement('br')); t.replaceWith(p); placeCaret(p);
  }
  markDirty();
}

function tableDialog() {
  const cell = (restoreSelection(), caretCell());
  if (cell) {                      // הסמן בתוך טבלה — עריכת הטבלה
    dialog(d => {
      d.innerHTML = '<h3>עריכת טבלה</h3>';
      const grid = document.createElement('div'); grid.className = 'tbl-actions';
      [['rowBefore','➕ שורה מעל'],['rowAfter','➕ שורה מתחת'],['colBefore','➕ עמודה מימין'],['colAfter','➕ עמודה משמאל'],
       ['delRow','➖ מחיקת שורה'],['delCol','➖ מחיקת עמודה'],['delTable','🗑 מחיקת הטבלה']].forEach(([a, label]) => {
        const b = document.createElement('button'); b.className = 'btn ' + (a === 'delTable' ? 'btn-danger' : 'btn-ghost'); b.textContent = label;
        b.onclick = () => { closeDialog(); tableAction(a, cell); }; grid.appendChild(b);
      });
      const tip = document.createElement('p'); tip.textContent = 'טיפ: מקש Tab עובר לתא הבא, ובתא האחרון מוסיף שורה.';
      const close = document.createElement('button'); close.className = 'btn btn-ghost'; close.textContent = 'סגירה'; close.onclick = closeDialog;
      d.append(grid, tip, close);
    });
    return;
  }
  dialog(d => {                    // בחירת גודל לטבלה חדשה
    d.innerHTML = '<h3>טבלה חדשה</h3><p>בחר כמה שורות וכמה עמודות</p>';
    const N = 8; let R = 3, C = 3;
    const label = document.createElement('div'); label.className = 'tbl-size';
    const pick = document.createElement('div'); pick.className = 'tbl-pick'; pick.style.gridTemplateColumns = `repeat(${N}, 1fr)`;
    const nums = document.createElement('div'); nums.className = 'tbl-nums';
    nums.innerHTML = '<label>שורות <input id="tR" type="number" min="1" max="30" value="3"></label><label>עמודות <input id="tC" type="number" min="1" max="12" value="3"></label>';
    const hdr = document.createElement('label'); hdr.className = 'tbl-hdr'; hdr.innerHTML = '<input id="tH" type="checkbox" checked> שורה ראשונה כותרת';
    const paint = () => { [...pick.children].forEach((c, i) => c.classList.toggle('on', Math.floor(i / N) < R && (i % N) < C));
      label.textContent = `${R} שורות × ${C} עמודות`; d.querySelector('#tR').value = R; d.querySelector('#tC').value = C; };
    for (let i = 0; i < N * N; i++) {
      const c = document.createElement('button'); c.type = 'button';
      const r = Math.floor(i / N) + 1, col = (i % N) + 1;
      c.onmouseenter = () => { R = r; C = col; paint(); };
      c.onclick = () => { R = r; C = col; paint(); go(); };
      pick.appendChild(c);
    }
    const row = document.createElement('div'); row.className = 'row';
    const ok = document.createElement('button'); ok.className = 'btn btn-primary'; ok.textContent = 'הוספת טבלה';
    const cancel = document.createElement('button'); cancel.className = 'btn btn-ghost'; cancel.textContent = 'ביטול'; cancel.onclick = closeDialog;
    const go = () => { const h = d.querySelector('#tH').checked; closeDialog(); insertTable(R, C, h); };
    ok.onclick = go; row.append(ok, cancel);
    d.append(label, pick, nums, hdr, row);
    const clamp = (v, a, b) => Math.max(a, Math.min(b, parseInt(v) || a));
    d.querySelector('#tR').oninput = e => { R = clamp(e.target.value, 1, 30); paint(); };
    d.querySelector('#tC').oninput = e => { C = clamp(e.target.value, 1, 12); paint(); };
    paint();
  });
}
$('tableBtn').addEventListener('click', tableDialog);

// Tab עובר בין התאים
$('editor').addEventListener('keydown', e => {
  if (e.key !== 'Tab') return;
  const cell = caretCell(); if (!cell) return;
  e.preventDefault();
  const cells = [...tableOf(cell).querySelectorAll('td,th')]; const i = cells.indexOf(cell);
  const next = cells[i + (e.shiftKey ? -1 : 1)];
  if (next) { const r = document.createRange(); r.selectNodeContents(next); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
  else if (!e.shiftKey) {
    tableAction('rowAfter', cells[cells.length - 1]);
    const rows = tableOf(cell).querySelectorAll('tr'); placeCaret(rows[rows.length - 1].firstElementChild);
  }
});


/* ================= לבן / כהה ================= */
function applyThemeIcon() {
  const dark = document.documentElement.dataset.theme === 'dark';
  document.querySelectorAll('[data-theme-toggle]').forEach(b => {
    b.textContent = b.classList.contains('menu-item') ? (dark ? '☀️ מצב בהיר' : '🌙 מצב כהה') : (dark ? '☀️' : '🌙');
    b.title = dark ? 'מעבר למצב בהיר' : 'מעבר למצב כהה';
  });
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = dark ? '#18221F' : '#E9F0F7';
}
document.querySelectorAll('[data-theme-toggle]').forEach(b => b.addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme !== 'dark';
  if (dark) document.documentElement.dataset.theme = 'dark'; else delete document.documentElement.dataset.theme;
  try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch {}
  applyThemeIcon();
}));
applyThemeIcon();


/* ================= ✨ סיכום למבחן (Gemini דרך Firebase AI Logic) ================= */
const AI_MODELS = ['gemini-3.5-flash', 'gemini-2.5-flash'];
let aiService = null;
function aiModel(name) {
  if (!aiService) aiService = getAI(fb, { backend: new GoogleAIBackend() });
  return getGenerativeModel(aiService, { model: name });
}
const SUMMARY_PROMPT = `אתה עוזר לתלמיד בחטיבת ביניים להתכונן למבחן.
לפניך החומר מהמחברת שלו: טקסט, ולפעמים גם תמונות של דפי מחברת בכתב יד או של הלוח.
הכן סיכום למבחן בעברית, ברור וקצר, שכולל:
1. הנושאים העיקריים, כל נושא עם הנקודות החשובות שלו.
2. מושגים והגדרות חשובים.
3. מספרים, תאריכים, שמות או רשימות שחשוב לזכור (אם יש).
4. טיפ או שניים לזכירה.
5. 5 שאלות לחזרה, ואחרי כל שאלה תשובה קצרה.
השתמש רק במידע שבמחברת. אם משהו בתמונה לא ברור, אל תמציא אותו.
החזר HTML בלבד, בלי markdown ובלי \`\`\`. מותר להשתמש רק בתגיות: h2, h3, p, ul, ol, li, b, mark, table, tr, th, td.
התחל בכותרת <h2>📝 סיכום למבחן</h2>.`;

async function notebookParts() {
  const ed = $('editor');
  const text = ed.innerText.trim();
  const images = [];
  for (const img of ed.querySelectorAll('img')) {
    const src = img.src || imgCache.get(img.getAttribute('data-img')) || '';
    const m = src.match(/^data:(image\/[\w+.-]+);base64,(.+)$/);
    if (m && images.length < 10) images.push({ inlineData: { mimeType: m[1], data: m[2] } });
  }
  return { text, images };
}

// שלב 1: על מה המבחן?
async function makeSummary() {
  await flush();
  const n = notebooks.find(x => x.id === openId); if (!n) return;
  const { text, images } = await notebookParts();
  if (!text && !images.length) { toast('המחברת ריקה, אין מה לסכם'); return; }
  // נושאים מהמחברת: הכותרות
  const heads = [...new Set([...$('editor').querySelectorAll('h1,h2,h3')].map(h => h.textContent.trim()).filter(t => t && t.length < 70 && !/סיכום למבחן/.test(t)))].slice(0, 16);
  dialog(d => {
    d.classList.add('topics-dlg');
    d.innerHTML = '<h3>✨ על מה המבחן?</h3><p>כתוב את הנושאים של המבחן, והסיכום יתמקד רק בהם. אפשר גם להשאיר ריק ולסכם את כל המחברת.</p>';
    const ta = document.createElement('textarea'); ta.rows = 3; ta.className = 'topics-input';
    ta.placeholder = 'למשל: דוד ובת-שבע; העונשים של דוד; פרק י"ב';
    ta.value = n.testTopics || '';
    d.appendChild(ta);
    if (heads.length) {
      const lab = document.createElement('div'); lab.className = 'chips-label'; lab.textContent = 'או לחץ על נושאים מהמחברת:';
      const box = document.createElement('div'); box.className = 'chips';
      const has = t => ta.value.split(/[;\n]/).map(x => x.trim()).includes(t);
      const sync = () => [...box.children].forEach(c => c.classList.toggle('on', has(c.textContent)));
      heads.forEach(t => {
        const c = document.createElement('button'); c.type = 'button'; c.className = 'chip-btn'; c.textContent = t;
        c.onclick = () => {
          const parts = ta.value.split(/[;\n]/).map(x => x.trim()).filter(Boolean);
          const i = parts.indexOf(t); if (i >= 0) parts.splice(i, 1); else parts.push(t);
          ta.value = parts.join('; '); sync();
        };
        box.appendChild(c);
      });
      ta.addEventListener('input', sync); sync();
      d.append(lab, box);
    }
    const row = document.createElement('div'); row.className = 'row';
    const go = document.createElement('button'); go.className = 'btn btn-sum'; go.innerHTML = '<svg><use href="#i-spark"/></svg>יצירת סיכום';
    const cancel = document.createElement('button'); cancel.className = 'btn btn-ghost'; cancel.textContent = 'ביטול'; cancel.onclick = closeDialog;
    go.onclick = () => {
      const topics = ta.value.trim();
      if (topics !== (n.testTopics || '')) updateDoc(nbDoc(n.id), { testTopics: topics }).catch(() => {});
      runSummary(n, text, images, topics);
    };
    row.append(go, cancel); d.append(row);
    setTimeout(() => ta.focus(), 50);
  });
}

// שלב 2: יצירת הסיכום
async function runSummary(n, text, images, topics) {
  let cancelled = false;
  dialog(d => {
    d.innerHTML = '<h3>✨ מכין סיכום למבחן...</h3>';
    const p = document.createElement('p'); p.textContent = topics ? `מתמקד ב: ${topics}` : 'מסכם את כל המחברת. זה לוקח בדרך כלל 10–30 שניות.';
    const sp = document.createElement('div'); sp.className = 'ai-spinner';
    const c = document.createElement('button'); c.className = 'btn btn-ghost'; c.textContent = 'ביטול';
    c.onclick = () => { cancelled = true; closeDialog(); }; d.append(p, sp, c);
  });
  const focus = topics
    ? `\n\nחשוב מאוד: המבחן הוא רק על הנושאים האלה: "${topics}".\nסכם רק את החומר שקשור לנושאים האלה, ודלג לגמרי על כל חומר אחר במחברת (גם בשאלות לחזרה).\nאם אחד הנושאים לא מופיע בכלל במחברת, כתוב את זה בשורה קצרה בסוף.\nהתחל בכותרת <h2>📝 סיכום למבחן: ${topics.replace(/[<>]/g, '')}</h2>.`
    : '';
  const parts = [SUMMARY_PROMPT + focus, `שם המחברת: ${n.title || ''}\n\nהטקסט במחברת:\n${text || '(אין טקסט, רק תמונות)'}`, ...images];
  let html = '', lastErr = null;
  for (const name of AI_MODELS) {
    try {
      const res = await aiModel(name).generateContent(parts);
      html = res.response.text(); if (html) break;
    } catch (e) { lastErr = e; console.error(name, e); }
  }
  if (cancelled) return;
  if (!html) { showAiError(lastErr); return; }
  html = clean(html.replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/, ''));
  showSummary(n, html, topics);
}

function showAiError(e) {
  const msg = String(e && (e.message || e.code) || '');
  let why = 'לא הצלחתי ליצור סיכום. נסה שוב בעוד דקה.';
  if (/api-not-enabled|not been used|disabled|PERMISSION_DENIED|403/i.test(msg)) why = 'צריך להפעיל את AI Logic בפרויקט ה-Firebase (ראה README, שלב 7).';
  else if (/app.?check|appcheck|attestation/i.test(msg)) why = recaptchaSiteKey && !recaptchaSiteKey.startsWith('PASTE') ? 'Firebase עדיין לא מזהה את האתר (App Check). בדוק שמפתח ה-reCAPTCHA נשמר ב-App Check ← Apps, וחכה כמה דקות.' : 'צריך להגדיר App Check עם reCAPTCHA כדי שהסיכום יעבוד (ראה README, שלב 7).';
  else if (/quota|429|RESOURCE_EXHAUSTED/i.test(msg)) why = 'הגעת למגבלת השימוש החינמית לרגע. נסה שוב בעוד כמה דקות.';
  dialog(d => {
    d.innerHTML = '<h3>לא הצלחתי ליצור סיכום</h3>';
    const p = document.createElement('p'); p.textContent = why;
    const small = document.createElement('p'); small.style.fontSize = '12px'; small.textContent = msg.slice(0, 200);
    const c = document.createElement('button'); c.className = 'btn btn-ghost'; c.textContent = 'סגירה'; c.onclick = closeDialog;
    d.append(p, small, c);
  });
}

function showSummary(n, html, topics) {
  dialog(d => {
    d.classList.add('ai-result');
    const box = document.createElement('div'); box.className = 'ai-box'; box.innerHTML = html;
    const row = document.createElement('div'); row.className = 'row';
    const add = document.createElement('button'); add.className = 'btn btn-primary'; add.textContent = 'הוספה לסוף המחברת';
    add.onclick = () => {
      if (openId !== n.id) openNotebook(n.id);
      const wrap = document.createElement('div'); wrap.innerHTML = html;
      $('editor').append(...wrap.childNodes); markDirty(); closeDialog();
      $('editor').lastElementChild && $('editor').lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'end' });
      toast('הסיכום נוסף לסוף המחברת');
    };
    const sep = document.createElement('button'); sep.className = 'btn btn-ghost'; sep.textContent = 'כמחברת חדשה';
    sep.onclick = async () => {
      try {
        const ref = doc(nbCol()); const now = Date.now();
        await setDoc(ref, { title: topics ? `סיכום – ${topics.slice(0, 40)}` : `סיכום – ${n.title || 'מחברת'}`, color: '#e08a1e', html, createdAt: now, updatedAt: now });
        closeDialog(); toast('נוצרה מחברת סיכום חדשה');
        const wait = () => notebooks.find(x => x.id === ref.id) ? openNotebook(ref.id) : setTimeout(wait, 100); wait();
      } catch { toast('לא הצלחתי לשמור'); }
    };
    const close = document.createElement('button'); close.className = 'btn btn-ghost'; close.textContent = 'סגירה'; close.onclick = closeDialog;
    row.append(add, sep, close); d.append(box, row);
  });
}
$('sumBtn').addEventListener('click', makeSummary);


/* ================= מסך בית ================= */
function firstName() {
  const n = (me && (me.displayName || (me.email || '').split('@')[0])) || '';
  return n.trim().split(/\s+/)[0] || '';
}
function greeting() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'בוקר טוב';
  if (h >= 12 && h < 17) return 'צהריים טובים';
  if (h >= 17 && h < 21) return 'ערב טוב';
  return 'לילה טוב';
}
function daysUntil(k) { const a = fromKey(k), t = fromKey(todayKey()); return Math.round((a - t) / 86400000); }
function countUp(el, to) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || to <= 0) { el.textContent = to; return; }
  const start = performance.now(), dur = 700;
  const tick = now => { const p = Math.min(1, (now - start) / dur); el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}
let homeAnimated = false;
function renderHome() {
  renderStats();
  const now = new Date();
  $('homeDate').textContent = `יום ${HE_DAYS[now.getDay()]}, ${now.getDate()} ב${HE_MONTHS[now.getMonth()]}`;
  const name = firstName();
  $('greet').textContent = name ? `${greeting()}, ${name}` : greeting();
  const tk = todayKey();
  const today = events.filter(e => e.date === tk);
  const open = today.filter(e => !e.done).length;
  $('greetSub').textContent = !today.length ? 'אין לך כלום ביומן היום.' : open ? (open === 1 ? 'יש לך דבר אחד ביומן היום.' : `יש לך ${open} דברים ביומן היום.`) : 'סיימת את כל מה שהיה ביומן היום 🎉';

  // ספירה לאחור למבחן הבא
  const tests = events.filter(e => e.type === 'test' && !e.done && e.date >= tk);
  const nt = $('nextTest'); nt.innerHTML = '';
  const h = document.createElement('h3'); h.textContent = 'המבחן הבא';
  if (tests.length) {
    const t = tests[0], d = daysUntil(t.date);
    const big = document.createElement('div'); big.className = 'big';
    const num = document.createElement('span'); num.className = 'num'; num.textContent = d;
    const unit = document.createElement('span'); unit.className = 'unit';
    if (d === 0) { num.textContent = 'היום'; num.classList.add('word'); }
    else if (d === 1) { num.textContent = 'מחר'; num.classList.add('word'); }
    else unit.textContent = 'ימים';
    big.append(num, unit);
    const what = document.createElement('div'); what.className = 'what'; what.textContent = t.title;
    const when = document.createElement('div'); when.className = 'when'; const dd = fromKey(t.date);
    when.textContent = `יום ${HE_DAYS[dd.getDay()]}, ${dd.getDate()} ב${HE_MONTHS[dd.getMonth()]}` + (t.time ? ` · ${t.time}` : '');
    nt.append(h, big, what, when);
    if (d > 1 && !homeAnimated) countUp(num, d);
    nt.classList.toggle('soon', d <= 3);
  } else {
    const big = document.createElement('div'); big.className = 'big'; big.innerHTML = '<span class="num word">אין</span>';
    const what = document.createElement('div'); what.className = 'what'; what.textContent = 'אין מבחנים ביומן כרגע';
    const add = document.createElement('button'); add.className = 'link'; add.textContent = 'הוספת מבחן ליומן'; add.onclick = () => showTab('cal');
    nt.append(h, big, what, add); nt.classList.remove('soon');
  }

  // היום
  const tc = $('todayCard'); tc.innerHTML = '';
  const h2 = document.createElement('h3'); h2.textContent = 'היום';
  tc.appendChild(h2);
  if (today.length) today.forEach(e => tc.appendChild(evRow(e, false)));
  else { const p = document.createElement('p'); p.className = 'noev'; p.textContent = 'יום פנוי. זמן טוב לחזור על החומר.'; tc.appendChild(p); }
  const up = events.filter(e => e.date > tk && !e.done).slice(0, 3);
  if (up.length) { const h3 = document.createElement('h4'); h3.textContent = 'בקרוב'; tc.appendChild(h3); up.forEach(e => tc.appendChild(evRow(e, true))); }

  // המשך מאיפה שעצרת
  const rc = $('recentCard'); rc.innerHTML = '';
  const h4 = document.createElement('h3'); h4.textContent = 'להמשיך מאיפה שעצרת';
  rc.appendChild(h4);
  if (notebooks.length) {
    const row = document.createElement('div'); row.className = 'recent';
    notebooks.slice(0, 4).forEach((n, i) => row.appendChild(nbCard(n, i)));
    rc.appendChild(row);
  } else {
    const p = document.createElement('p'); p.className = 'noev'; p.textContent = 'עוד אין לך מחברות.';
    const b = document.createElement('button'); b.className = 'btn btn-primary'; b.textContent = 'ליצור מחברת ראשונה'; b.onclick = newNotebook;
    rc.append(p, b);
  }
  homeAnimated = true;
}


/* ================= ציר זמן ================= */
function tlItem(date = '', text = '') {
  const li = document.createElement('li');
  const b = document.createElement('b'); b.textContent = date;
  const sp = document.createElement('span'); sp.textContent = text;
  li.append(b, sp); return li;
}
function caretTlItem() {
  const s = window.getSelection(); if (!s.rangeCount) return null;
  const n = s.getRangeAt(0).startContainer; const el = n.nodeType === 1 ? n : n.parentElement;
  return el && $('editor').contains(el) ? el.closest('ol.tl > li') : null;
}
function insertTimeline(count) {
  restoreSelection();
  const ol = document.createElement('ol'); ol.className = 'tl';
  for (let i = 0; i < count; i++) ol.appendChild(tlItem());
  insertBlockAtCaret(ol);
  const after = document.createElement('p'); after.appendChild(document.createElement('br')); ol.after(after);
  placeCaret(ol.querySelector('b')); markDirty();
}
function tlAction(act, li) {
  const ol = li.closest('ol.tl');
  if (act === 'after' || act === 'before') { const n = tlItem(); act === 'after' ? li.after(n) : li.before(n); placeCaret(n.querySelector('b')); }
  else if (act === 'up' && li.previousElementSibling) { li.previousElementSibling.before(li); placeCaret(li.querySelector('b')); }
  else if (act === 'down' && li.nextElementSibling) { li.nextElementSibling.after(li); placeCaret(li.querySelector('b')); }
  else if (act === 'del') {
    if (ol.children.length <= 1) return tlAction('delAll', li);
    const next = li.nextElementSibling || li.previousElementSibling; li.remove(); placeCaret(next.querySelector('b') || next);
  } else if (act === 'delAll') { const p = document.createElement('p'); p.appendChild(document.createElement('br')); ol.replaceWith(p); placeCaret(p); }
  markDirty();
}
function timelineDialog() {
  restoreSelection();
  const li = caretTlItem();
  if (li) {
    dialog(d => {
      d.innerHTML = '<h3>עריכת ציר זמן</h3>';
      const grid = document.createElement('div'); grid.className = 'tbl-actions';
      [['before','➕ אירוע לפני'],['after','➕ אירוע אחרי'],['up','⬆ הזזה למעלה'],['down','⬇ הזזה למטה'],['del','➖ מחיקת האירוע'],['delAll','🗑 מחיקת ציר הזמן']].forEach(([a, label]) => {
        const b = document.createElement('button'); b.className = 'btn ' + (a === 'delAll' ? 'btn-danger' : 'btn-ghost'); b.textContent = label;
        b.onclick = () => { closeDialog(); tlAction(a, li); }; grid.appendChild(b);
      });
      const tip = document.createElement('p'); tip.textContent = 'טיפ: Enter בסוף אירוע מוסיף אירוע חדש אחריו.';
      const close = document.createElement('button'); close.className = 'btn btn-ghost'; close.textContent = 'סגירה'; close.onclick = closeDialog;
      d.append(grid, tip, close);
    });
    return;
  }
  dialog(d => {
    d.innerHTML = '<h3>ציר זמן חדש</h3><p>כמה אירועים יהיו בציר? תמיד אפשר להוסיף עוד אחר כך.</p>';
    const lab = document.createElement('label'); lab.className = 'tl-count';
    const minus = document.createElement('button'); minus.type = 'button'; minus.className = 'btn btn-ghost icon-btn'; minus.textContent = '−';
    const num = document.createElement('span'); num.className = 'tl-num'; let n = 4; num.textContent = n;
    const plus = document.createElement('button'); plus.type = 'button'; plus.className = 'btn btn-ghost icon-btn'; plus.textContent = '+';
    const prev = document.createElement('div'); prev.className = 'tl-preview';
    const paint = () => { num.textContent = n; prev.innerHTML = ''; for (let i = 0; i < Math.min(n, 8); i++) prev.appendChild(document.createElement('i')); };
    minus.onclick = () => { n = Math.max(1, n - 1); paint(); };
    plus.onclick = () => { n = Math.min(20, n + 1); paint(); };
    lab.append(minus, num, plus); paint();
    const row = document.createElement('div'); row.className = 'row';
    const ok = document.createElement('button'); ok.className = 'btn btn-primary'; ok.textContent = 'הוספת ציר זמן';
    ok.onclick = () => { closeDialog(); insertTimeline(n); };
    const cancel = document.createElement('button'); cancel.className = 'btn btn-ghost'; cancel.textContent = 'ביטול'; cancel.onclick = closeDialog;
    row.append(ok, cancel); d.append(prev, lab, row);
  });
}
$('tlBtn').addEventListener('click', timelineDialog);

// Enter בציר זמן: מהתאריך לתיאור, ומהתיאור לאירוע חדש
$('editor').addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.shiftKey) return;
  const li = caretTlItem(); if (!li) return;
  e.preventDefault();
  const s = window.getSelection(); const n = s.getRangeAt(0).startContainer; const el = n.nodeType === 1 ? n : n.parentElement;
  if (el.closest('b')) { let sp = li.querySelector('span'); if (!sp) { sp = document.createElement('span'); li.appendChild(sp); } placeCaret(sp); return; }
  if (isEmpty(li)) { // Enter על אירוע ריק = יציאה מציר הזמן
    const ol = li.closest('ol.tl'); const p = document.createElement('p'); p.appendChild(document.createElement('br'));
    if (ol.children.length > 1) li.remove(); ol.after(p); placeCaret(p); markDirty(); return;
  }
  const next = li.nextElementSibling;
  if (next && isEmpty(next)) { placeCaret(next.querySelector('b') || next); return; }
  tlAction('after', li);
});


/* ================= לוח עיצוב חופשי (בסגנון Canva): טקסט וקווים ================= */
const LINE_COLORS = ['#1D1D1F', '#5E5CE6', '#E5484D', '#10B981', '#3B82F6', '#F59E0B'];
const TEXT_COLORS = ['#1D1D1F', '#5E5CE6', '#E5484D', '#10B981', '#3B82F6', '#F59E0B', '#FFFFFF'];
const TEXT_BGS = ['none', '#FFF3A3', '#DCEBFF', '#D9F5E8', '#FFE0EA', '#EEE7FF', '#1D1D1F'];
const CV_W = 800;
const FONTS = { rubik: ["'Rubik',sans-serif", 'Rubik'], suez: ["'Suez One',serif", 'Suez One'], secular: ["'Secular One',sans-serif", 'Secular One'], assistant: ["'Assistant',sans-serif", 'Assistant'], varela: ["'Varela Round',sans-serif", 'Varela Round'], amatic: ["'Amatic SC',cursive", 'Amatic (כתב יד)'] };
function oldLineToLn(v) {
  const [L, A, W, C, D, R] = v.split('|'); const rad = +A * Math.PI / 180, l = Math.min(+L, 760);
  const dx = Math.cos(rad) * l / 2, dy = Math.sin(rad) * l / 2, cy = Math.abs(dy) + 30;
  return [400 - dx, cy + dy, 400 + dx, cy - dy].map(n => Math.max(5, Math.round(n))).concat([W, C, D, R]).join('|');
}
const num = (v, lo, hi, d) => { v = +v; return Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v * 10) / 10)) : d; };
const hex = (v, d) => /^#[0-9a-fA-F]{6}$/.test(v || '') ? v : d;
function cvSan(o) {
  if (!o || typeof o !== 'object') return null;
  const h = num(o.h, 80, 3000, 300); const items = [];
  (Array.isArray(o.items) ? o.items : []).slice(0, 80).forEach(it => {
    if (!it) return;
    if (it.t === 'l') items.push({ t: 'l', x1: num(it.x1, 0, CV_W, 200), y1: num(it.y1, 0, h, 40), x2: num(it.x2, 0, CV_W, 600), y2: num(it.y2, 0, h, 40), w: num(it.w, 1, 16, 3), c: hex(it.c, '#1D1D1F'), d: !!it.d, r: !!it.r, lk: !!it.lk });
    else if (it.t === 'x') items.push({ t: 'x', x: num(it.x, -200, CV_W, 300), y: num(it.y, -50, h, 40), w: num(it.w, 30, CV_W, 240), rot: num(it.rot, -180, 180, 0), s: num(it.s, 8, 120, 22),
      c: hex(it.c, '#1D1D1F'), bg: it.bg === 'none' ? 'none' : hex(it.bg, 'none'), b: !!it.b, a: ['right', 'center', 'left'].includes(it.a) ? it.a : 'center', text: String(it.text || '').slice(0, 3000), f: FONTS[it.f] ? it.f : 'rubik', lk: !!it.lk });
  });
  return { h, items };
}
function cvParse(str) { try { return cvSan(JSON.parse(str)); } catch { return null; } }

let selCv = null, selIdx = -1, editing = false;
const cvData = el => cvParse(el.getAttribute('data-cv')) || { h: 300, items: [] };
const cvSave = (el, o) => { el.setAttribute('data-cv', JSON.stringify(cvSan(o))); markDirty(); };
const cvScale = el => (el.clientWidth || CV_W) / CV_W;
const ro = new ResizeObserver(es => es.forEach(e => fitCv(e.target)));
function fitCv(el) {
  const st = el.querySelector('.cv-stage'); if (!st) return;
  const k = cvScale(el), h = +st.dataset.h;
  st.style.transform = `scale(${k})`; el.style.height = (h * k) + 'px'; el.style.setProperty('--k', k);
}

function renderCanvases(root) { root.querySelectorAll('div[data-cv]').forEach(drawCv); }
function drawCv(el) {
  const o = cvData(el), isSel = el === selCv;
  if (!o.items.length && !editing) { if (selCv === el) selCv = null; const n = el.nextElementSibling; el.remove(); if (n && n.tagName === 'P' && isEmpty(n) && n.previousElementSibling) n.remove(); markDirty(); return; }
  el.contentEditable = 'false'; el.className = 'cv' + (isSel ? ' sel' : '');
  const st = document.createElement('div'); st.className = 'cv-stage'; st.dataset.h = o.h;
  st.style.width = CV_W + 'px'; st.style.height = o.h + 'px';
  o.items.forEach((it, i) => st.appendChild(it.t === 'l' ? lineEl(it, i, isSel && i === selIdx) : textEl(it, i, isSel && i === selIdx)));
  const si = isSel ? o.items[selIdx] : null;
  if (si && si.t === 'l' && !si.lk) st.appendChild(lineHandles(si, selIdx));
  st.insertAdjacentHTML('beforeend', '<i class="cv-guide v"></i><i class="cv-guide h"></i>');
  el.innerHTML = ''; el.appendChild(st);
  if (isSel && si) el.appendChild(cvBar(o));
  fitCv(el); ro.observe(el);
  autoH(el, o, st);
  if (si) placeMini(el, si);
}
// בלי מסגרת: גובה האזור נקבע לפי הפריטים עצמם
function autoH(el, o, st) {
  if (drag) return;
  let bottom = 0, ok = true;
  o.items.forEach((it, i) => {
    if (it.t === 'l') bottom = Math.max(bottom, Math.max(it.y1, it.y2) + it.w / 2 + 8);
    else { const t = st.querySelector(`.cv-text[data-i="${i}"]`); if (!t || !t.offsetHeight) ok = false; else bottom = Math.max(bottom, it.y + t.offsetHeight + 8); }
  });
  if (!ok) return;
  const h = Math.max(24, Math.ceil(bottom));
  if (h !== o.h) { o.h = h; el.setAttribute('data-cv', JSON.stringify(cvSan(o))); st.dataset.h = h; st.style.height = h + 'px'; fitCv(el); }
}
function lineHandles(it, i) {
  const g = document.createElement('div'); g.className = 'cv-lh'; g.dataset.i = i; posLineHandles(g, it);
  g.innerHTML = '<span class="hd lrot" data-h="lrot" title="סיבוב"></span><span class="hd lmv" data-h="move" title="הזזה"></span>';
  return g;
}
function posLineHandles(g, it) {
  const mx = (it.x1 + it.x2) / 2, my = (it.y1 + it.y2) / 2, len = Math.hypot(it.x2 - it.x1, it.y2 - it.y1) || 1;
  const nx = -(it.y2 - it.y1) / len, ny = (it.x2 - it.x1) / len;           // ניצב לקו
  const off = 34, sx = ny > 0 || (ny === 0 && nx > 0) ? 1 : -1;
  g.style.left = (mx + nx * off * sx) + 'px'; g.style.top = (my + ny * off * sx) + 'px';
}
// סרגל קטן ליד הפריט, כמו בקנבה: מחיקה, שכפול, נעילה
function placeMini(el, it) {
  const m = document.createElement('div'); m.className = 'cv-mini';
  m.innerHTML = `<button data-a="del" title="מחיקה">🗑</button><button data-a="dup" title="שכפול">⧉</button><button data-a="lock" class="${it.lk ? 'on' : ''}" title="${it.lk ? 'ביטול נעילה' : 'נעילה'}">${it.lk ? '🔒' : '🔓'}</button>`;
  el.appendChild(m);
  const k = cvScale(el); let cx, top;
  if (it.t === 'l') { cx = (it.x1 + it.x2) / 2 * k; top = Math.min(it.y1, it.y2) * k; }
  else { const t = el.querySelector(`.cv-text[data-i="${selIdx}"]`); const r = t.getBoundingClientRect(), cr = el.getBoundingClientRect(); cx = r.left - cr.left + r.width / 2; top = r.top - cr.top; }
  const mt = top - 44; m.style.left = cx + 'px'; m.style.top = mt + 'px';
  // הסרגל הגדול יושב ממש מעל הסרגל הקטן, ליד הפריט
  const bar = el.querySelector('.cv-bar'); if (bar) { bar.style.bottom = 'auto'; bar.style.top = (mt - bar.offsetHeight - 6) + 'px'; }
}
function lineEl(it, i, sel) {
  const id = 'm' + Math.random().toString(36).slice(2, 7);
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); g.setAttribute('class', 'cv-line' + (sel ? ' on' : '')); g.dataset.i = i;
  let h = '';
  if (it.r) h += `<defs><marker id="${id}" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="${Math.max(3.5, 10 / it.w + 2)}" markerHeight="${Math.max(3.5, 10 / it.w + 2)}" orient="auto"><path d="M0 0L10 5L0 10z" fill="${it.c}" class="ink"/></marker></defs>`;
  h += `<line class="hit" x1="${it.x1}" y1="${it.y1}" x2="${it.x2}" y2="${it.y2}"/>`;
  h += `<line class="ink main" x1="${it.x1}" y1="${it.y1}" x2="${it.x2}" y2="${it.y2}" stroke="${it.c}" stroke-width="${it.w}"${it.d ? ` stroke-dasharray="${it.w * 3} ${it.w * 2.5}"` : ''}${it.r ? ` marker-end="url(#${id})"` : ''}/>`;
  if (sel && !it.lk) h += `<circle class="hd" data-h="p1" cx="${it.x1}" cy="${it.y1}"/><circle class="hd" data-h="p2" cx="${it.x2}" cy="${it.y2}"/>`;
  g.innerHTML = h; return g;
}
function textEl(it, i, sel) {
  const d = document.createElement('div'); d.className = 'cv-text' + (sel ? ' on' : ''); d.dataset.i = i;
  d.style.cssText = `left:${it.x}px;top:${it.y}px;width:${it.w}px;transform:rotate(${it.rot}deg)`;
  const tx = document.createElement('div'); tx.className = 'tx'; tx.dir = 'auto';
  tx.style.cssText = `font-family:${FONTS[it.f][0]};font-size:${it.s}px;color:${it.c};font-weight:${it.b ? 700 : 400};text-align:${it.a};` + (it.bg !== 'none' ? `background:${it.bg};padding:.25em .45em;border-radius:.35em;` : '');
  tx.textContent = it.text; if (!it.text) tx.dataset.ph = 'כתוב כאן';
  d.appendChild(tx);
  if (sel && it.lk) d.classList.add('locked');
  if (sel && !it.lk) ['w', 'e', 'nw', 'ne', 'sw', 'se', 'rot', 'mv'].forEach(hh => { const b = document.createElement('span'); b.className = 'hd ' + hh; b.dataset.h = hh; d.appendChild(b); });
  return d;
}
function cvBar(o) {
  const it = o.items[selIdx]; const bar = document.createElement('div'); bar.className = 'cv-bar';
  const btn = (a, label, on, title) => `<button data-a="${a}" class="${on ? 'on' : ''}" title="${title || ''}">${label}</button>`;
  const dots = (a, list, cur) => list.map(c => `<button data-a="${a}" data-v="${c}" class="dot${c === cur ? ' on' : ''}" style="${c === 'none' ? '' : 'background:' + c}" title="${c === 'none' ? 'בלי רקע' : ''}">${c === 'none' ? '⌀' : ''}</button>`).join('');
  let h = '';
  if (!it) h = btn('addH1', '<b>הוסף כותרת</b>') + btn('addH2', 'הוסף כותרת משנה') + btn('addBody', '<small>הוסף גוף טקסט</small>') + '<i></i>' + btn('addLine', '＋ קו') + '<i></i>' + btn('delCv', '🗑 מחיקת הלוח');
  else if (it.lk) h = '<span class="lbl">🔒 הפריט נעול. לחץ על המנעול כדי לערוך אותו.</span>';
  else if (it.t === 'x') h = `<select data-a="font" title="גופן">${Object.entries(FONTS).map(([k, v]) => `<option value="${k}"${k === it.f ? ' selected' : ''} style="font-family:${v[0]}">${v[1]}</option>`).join('')}</select>` + '<i></i>'
    + btn('sDown', '−', 0, 'הקטנת גופן') + `<input data-a="size" type="number" min="8" max="120" value="${Math.round(it.s)}" title="גודל גופן">` + btn('sUp', '+', 0, 'הגדלת גופן') + '<i></i>'
    + btn('bold', '<b>B</b>', it.b, 'מודגש') + btn('align', `<svg><use href="#i-al-${{ right: 'r', center: 'c', left: 'l' }[it.a]}"/></svg>`, 0, 'יישור (ימין / שמאל / מרכז)') + '<i></i>'
    + dots('color', TEXT_COLORS, it.c) + '<i></i><span class="lbl">רקע</span>' + dots('bg', TEXT_BGS, it.bg) + (it.rot ? '<i></i>' + btn('rot0', '⟲', 0, 'ביטול סיבוב') : '');
  else h = btn('wDown', '−', 0, 'דק יותר') + `<span class="v">${it.w}</span>` + btn('wUp', '+', 0, 'עבה יותר') + '<i></i>' + dots('lcolor', LINE_COLORS, it.c) + '<i></i>' + btn('dash', 'מקווקו', it.d) + btn('arrow', 'חץ', it.r);
  bar.innerHTML = h; return bar;
}
function selectCv(el, idx = -1) {
  const prev = selCv; selCv = el; selIdx = idx; editing = false;
  if (prev && prev !== el && prev.isConnected) drawCv(prev);
  if (el) drawCv(el);
}
function newCvAtCaret(h = 300) {
  restoreSelection();
  const el = document.createElement('div'); el.setAttribute('data-cv', JSON.stringify({ h, items: [] }));
  insertBlockAtCaret(el);
  if (!el.nextElementSibling) { const after = document.createElement('p'); after.appendChild(document.createElement('br')); el.after(after); }
  return el;
}
const PRESETS = { h1: { s: 52, b: true, w: 520, text: 'הוסף כותרת' }, h2: { s: 32, b: true, w: 440, text: 'הוסף כותרת משנה' }, body: { s: 19, b: false, w: 380, text: 'הוסף גוף טקסט' }, x: { s: 26, b: false, w: 300, text: '' } };
function addItem(kind, preset = 'x') {
  let el = selCv && selCv.isConnected ? selCv : newCvAtCaret();
  const o = cvData(el); const cy = o.items.length ? Math.min(o.h - 40, 40 + (o.items.length % 5) * 40) : o.h / 2 - 20;
  if (kind === 'x') { const P = PRESETS[preset] || PRESETS.x;
    // מתחת לטקסט האחרון, כדי שלא ייפול עליו; הלוח גדל אם צריך
    const lastX = [...el.querySelectorAll('.cv-text')].pop(), k = cvScale(el);
    let ny = o.items.length ? cy - P.s / 2 : 6;
    if (lastX) { const r = lastX.getBoundingClientRect(), sr = el.querySelector('.cv-stage').getBoundingClientRect(); ny = (r.bottom - sr.top) / k + 14; }
    const need = ny + P.s * 1.6 + 20; if (need > o.h) o.h = Math.min(2000, Math.ceil(need));
    o.items.push({ t: 'x', x: (CV_W - P.w) / 2, y: ny, w: P.w, rot: 0, s: P.s, c: '#1D1D1F', bg: 'none', b: P.b, a: 'center', text: P.text, f: 'rubik' }); }
  else { const ly = o.items.length ? o.h + 16 : 18; o.h = Math.max(o.h, ly + 16); o.items.push({ t: 'l', x1: 250, y1: ly, x2: 550, y2: ly, w: 3, c: '#1D1D1F', d: false, r: false }); }
  el.setAttribute('data-cv', JSON.stringify(cvSan(o))); markDirty();
  selectCv(el, o.items.length - 1);
  if (kind === 'x') { startEdit(el, o.items.length - 1); if (preset !== 'x') { const t = el.querySelector(`.cv-text[data-i="${o.items.length - 1}"] .tx`); if (t) { const r = document.createRange(); r.selectNodeContents(t); const sl = getSelection(); sl.removeAllRanges(); sl.addRange(r); } } }
}
$('lineBtn').addEventListener('click', () => addItem('l'));

// ---- עריכת טקסט (לחיצה כפולה, או לחיצה על טקסט שכבר מסומן)
function startEdit(el, i) {
  const t = el.querySelector(`.cv-text[data-i="${i}"] .tx`); if (!t) return;
  editing = true; el.classList.add('editing');
  try { t.contentEditable = 'plaintext-only'; } catch { t.contentEditable = 'true'; }
  if (t.contentEditable !== 'plaintext-only') t.contentEditable = 'true';
  delete t.dataset.ph; t.focus();
  const r = document.createRange(); r.selectNodeContents(t); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  t.oninput = () => { const o = cvData(el); if (o.items[i]) { o.items[i].text = t.innerText.replace(/\n$/, ''); el.setAttribute('data-cv', JSON.stringify(cvSan(o))); markDirty(); } };
  t.onblur = () => {
    editing = false; el.classList.remove('editing');
    const o = cvData(el);
    if (o.items[i] && o.items[i].t === 'x' && !o.items[i].text.trim()) { o.items.splice(i, 1); cvSave(el, o); if (selCv === el) selIdx = -1; }
    if (el.isConnected) drawCv(el);
  };
  t.onkeydown = e => { if (e.key === 'Escape') t.blur(); e.stopPropagation(); };
}

// ---- גרירה: הזזה, מתיחה מהצדדים/פינות, סיבוב, קצוות של קו, גובה הלוח
let drag = null;
const stagePt = (el, e) => { const r = el.querySelector('.cv-stage').getBoundingClientRect(), k = cvScale(el); return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k }; };
$('editor').addEventListener('pointerdown', e => {
  const el = e.target.closest('.cv');
  if (!el) { if (selCv && !editing) selectCv(null); return; }
  if (e.target.closest('.cv-bar, .cv-mini')) return;
  if (editing && e.target.closest('.tx[contenteditable="true"], .tx[contenteditable="plaintext-only"]')) return;
  const rz = e.target.closest('.cv-rz');
  const itemEl = e.target.closest('.cv-text, .cv-line, .cv-lh');
  const onLineHit = e.target.closest('.hit, .hd');
  if (!rz && (!itemEl || (itemEl.classList.contains('cv-line') && !onLineHit))) {   // לחיצה על שטח ריק: סימון הלוח
    if (editing) document.activeElement.blur();
    selectCv(null); return;
  }
  e.preventDefault();
  const o = cvData(el);
  if (rz) { drag = { el, kind: 'rz', o0: o, p0: stagePt(el, e), id: e.pointerId }; el.setPointerCapture(e.pointerId); return; }
  const i = +itemEl.dataset.i;
  const wasSel = selCv === el && selIdx === i;
  const h = e.target.closest('.hd') ? e.target.closest('.hd').dataset.h : 'move';
  if (!wasSel) selectCv(el, i);
  if (o.items[i] && o.items[i].lk) return;                       // פריט נעול: רק מסמנים
  drag = { el, kind: h, i, wasSel, o0: JSON.parse(JSON.stringify(o)), p0: stagePt(el, e), id: e.pointerId, moved: false };
  el.setPointerCapture(e.pointerId); el.classList.add('dragging');
});
$('editor').addEventListener('dblclick', e => { const t = e.target.closest('.cv-text'); const el = e.target.closest('.cv'); if (t && el) startEdit(el, +t.dataset.i); });
$('editor').addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.id) return;
  const { el, kind, i, o0, p0 } = drag; const p = stagePt(el, e); const dx = p.x - p0.x, dy = p.y - p0.y;
  if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
  const o = JSON.parse(JSON.stringify(o0)); const st = el.querySelector('.cv-stage');
  const gv = st.querySelector('.cv-guide.v'), gh = st.querySelector('.cv-guide.h'); gv.classList.remove('show'); gh.classList.remove('show');
  if (kind === 'rz') {
    const minH = Math.max(80, ...o.items.map(it => it.t === 'l' ? Math.max(it.y1, it.y2) + 10 : it.y + 40));
    o.h = Math.max(minH, Math.min(3000, o0.h + dy));
  } else {
    const it = o.items[i];
    if (it.t === 'l') {
      if (kind === 'move') { it.x1 += dx; it.x2 += dx; it.y1 += dy; it.y2 += dy; }
      else if (kind === 'lrot') {
        const c0 = o0.items[i], mx = (c0.x1 + c0.x2) / 2, my = (c0.y1 + c0.y2) / 2, len = Math.hypot(c0.x2 - c0.x1, c0.y2 - c0.y1);
        let ang = Math.atan2(my - p.y, p.x - mx) * 180 / Math.PI + 90; const sn = Math.round(ang / 15) * 15; if (Math.abs(ang - sn) < 4) ang = sn;
        const r = ang * Math.PI / 180, hx = Math.cos(r) * len / 2, hy = Math.sin(r) * len / 2;
        it.x1 = mx - hx; it.y1 = my + hy; it.x2 = mx + hx; it.y2 = my - hy;
      } else {
        const [fx, fy] = kind === 'p1' ? [it.x2, it.y2] : [it.x1, it.y1];
        let x = p.x, y = p.y; const ang = Math.atan2(fy - y, x - fx) * 180 / Math.PI, len = Math.hypot(x - fx, y - fy), sn = Math.round(ang / 15) * 15;
        if (Math.abs(ang - sn) < 3.5 && !e.shiftKey) { const r = sn * Math.PI / 180; x = fx + Math.cos(r) * len; y = fy - Math.sin(r) * len; }
        if (kind === 'p1') { it.x1 = x; it.y1 = y; } else { it.x2 = x; it.y2 = y; }
      }
      const by = Math.max(it.y1, it.y2); if (by > o.h - 12) o.h = by + 12;
      let a = Math.round(Math.atan2(it.y1 - it.y2, it.x2 - it.x1) * 180 / Math.PI); if (a < 0) a += 360;
      tipShow(el, `אורך: ${Math.round(Math.hypot(it.x2 - it.x1, it.y2 - it.y1))} · ${a}°`);
      // קו עזר כשהקו ישר לגמרי (אנכי / אופקי)
      if (kind !== 'move' && (a % 180 === 90)) { gv.style.left = it.x1 + 'px'; gv.classList.add('show'); }
      if (kind !== 'move' && (a % 180 === 0)) { gh.style.top = it.y1 + 'px'; gh.classList.add('show'); }
    } else {
      const tEl = st.querySelector(`.cv-text[data-i="${i}"]`); const hgt = tEl ? tEl.offsetHeight : 40;
      const rad = it.rot * Math.PI / 180, dl = dx * Math.cos(rad) + dy * Math.sin(rad);
      if (kind === 'move') {
        it.x += dx; it.y += dy;
        const cx = it.x + it.w / 2; if (Math.abs(cx - CV_W / 2) < 8) { it.x = CV_W / 2 - it.w / 2; gv.style.left = (CV_W / 2) + 'px'; gv.classList.add('show'); }   // הצמדה לאמצע
        const cyy = it.y + hgt / 2; if (Math.abs(cyy - o.h / 2) < 8) { it.y = o.h / 2 - hgt / 2; gh.style.top = (o.h / 2) + 'px'; gh.classList.add('show'); }
      } else if (kind === 'mv') { it.x += dx; it.y += dy; }
      else if (kind === 'e') { it.w = Math.max(30, o0.items[i].w + dl); }
      else if (kind === 'w') { const nw = Math.max(30, o0.items[i].w - dl); it.x = o0.items[i].x + (o0.items[i].w - nw); it.w = nw; }
      else if (kind === 'rot') {
        const c0 = o0.items[i]; const cx = c0.x + c0.w / 2, cyy = c0.y + hgt / 2;
        let a = Math.atan2(p.y - cyy, p.x - cx) * 180 / Math.PI - 90; a = ((a + 540) % 360) - 180;
        for (const sn of [-180, -90, -45, 0, 45, 90, 180]) if (Math.abs(a - sn) < 4) a = sn;
        it.rot = Math.round(a); tipShow(el, `${it.rot}°`);
      } else {   // פינות: הגדלה/הקטנה של כל התיבה כולל הגופן
        const sign = kind.includes('e') ? 1 : -1; const f = Math.max(0.2, (o0.items[i].w + sign * dl) / o0.items[i].w);
        it.w = Math.max(30, o0.items[i].w * f); it.s = Math.max(8, Math.min(120, o0.items[i].s * f));
        if (sign < 0) it.x = o0.items[i].x + (o0.items[i].w - it.w);
        if (kind.includes('n')) it.y = o0.items[i].y + hgt * (1 - f);
        tipShow(el, `${Math.round(it.s)}px`);
      }
      if (it.y + hgt > o.h - 8) o.h = Math.min(3000, it.y + hgt + 8);
    }
  }
  drag.cur = o;
  // ציור מהיר בזמן גרירה
  el.setAttribute('data-cv', JSON.stringify(cvSan(o)));
  st.dataset.h = o.h; st.style.height = o.h + 'px'; fitCv(el);
  if (kind !== 'rz') {
    const it = cvSan(o).items[i]; const old = st.querySelector(`[data-i="${i}"]`);
    const nu = it.t === 'l' ? lineEl(it, i, true) : textEl(it, i, true); old.replaceWith(nu);
    const lh = st.querySelector('.cv-lh'); if (lh && it.t === 'l') posLineHandles(lh, it);
    const mini = el.querySelector('.cv-mini'); if (mini) mini.remove();
  }
});
function tipShow(el, txt) { let t = el.querySelector('.cv-tip'); if (!t) { t = document.createElement('span'); t.className = 'cv-tip'; el.appendChild(t); } t.textContent = txt; t.classList.add('show'); }
function endDrag(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const { el, moved, wasSel, kind, i } = drag; el.classList.remove('dragging');
  const t = el.querySelector('.cv-tip'); if (t) t.classList.remove('show');
  if (drag.cur && moved) cvSave(el, drag.cur);
  drag = null; drawCv(el);
  // לחיצה (בלי גרירה) על טקסט שכבר מסומן = עריכת הטקסט
  if (!moved && wasSel && kind === 'move') { const it = cvData(el).items[i]; if (it && it.t === 'x') startEdit(el, i); }
}
$('editor').addEventListener('pointerup', endDrag);
$('editor').addEventListener('pointercancel', endDrag);

// ---- סרגל הכלים הצף מעל הבחירה
$('editor').addEventListener('click', e => {
  const b = e.target.closest('.cv-bar button, .cv-mini button'); if (!b) return;
  e.preventDefault(); e.stopPropagation();
  const el = b.closest('.cv'); const o = cvData(el); const it = o.items[selIdx]; const a = b.dataset.a, v = b.dataset.v;
  if (a === 'addText') return addItem('x');
  if (a === 'addH1') return addItem('x', 'h1');
  if (a === 'addH2') return addItem('x', 'h2');
  if (a === 'addBody') return addItem('x', 'body');
  if (a === 'addLine') return addItem('l');
  if (a === 'delCv') { selCv = null; el.remove(); markDirty(); return; }
  if (!it) return;
  if (a === 'lock') { it.lk = !it.lk; cvSave(el, o); drawCv(el); return; }
  if (it.lk) return;
  if (a === 'sDown') it.s = Math.max(8, Math.round(it.s / 1.15));
  else if (a === 'sUp') it.s = Math.min(120, Math.round(it.s * 1.15));
  else if (a === 'bold') it.b = !it.b;
  else if (a === 'align') it.a = { right: 'left', left: 'center', center: 'right' }[it.a];
  else if (a === 'color') it.c = v;
  else if (a === 'bg') it.bg = v;
  else if (a === 'rot0') it.rot = 0;
  else if (a === 'wDown') it.w = Math.max(1, it.w - 1);
  else if (a === 'wUp') it.w = Math.min(16, it.w + 1);
  else if (a === 'lcolor') it.c = v;
  else if (a === 'dash') it.d = !it.d;
  else if (a === 'arrow') it.r = !it.r;
  else if (a === 'dup') { const c = JSON.parse(JSON.stringify(it)); if (c.t === 'x') { c.x += 24; c.y += 24; } else { c.x1 += 24; c.x2 += 24; c.y1 += 24; c.y2 += 24; } o.items.push(c); cvSave(el, o); selectCv(el, o.items.length - 1); return; }
  else if (a === 'del') { o.items.splice(selIdx, 1); cvSave(el, o); selectCv(el, -1); return; }
  cvSave(el, o); drawCv(el);
});
document.addEventListener('keydown', e => {
  if (!selCv || editing || e.target.closest('input,textarea')) return;
  const o = cvData(selCv); const it = o.items[selIdx];
  if (e.key === 'Escape') { selectCv(null); return; }
  if (!it) return;
  if (it.lk) return;
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); o.items.splice(selIdx, 1); cvSave(selCv, o); selectCv(selCv, -1); return; }
  const step = e.shiftKey ? 10 : 1, mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
  if (mv) { e.preventDefault(); if (it.t === 'x') { it.x += mv[0]; it.y += mv[1]; } else { it.x1 += mv[0]; it.x2 += mv[0]; it.y1 += mv[1]; it.y2 += mv[1]; } cvSave(selCv, o); drawCv(selCv); }
  if (it.t === 'x' && e.key === 'Enter') { e.preventDefault(); startEdit(selCv, selIdx); }
});

/* ================= תיבת טקסט ================= */
const BOX_NAMES = { yellow: 'צהוב', blue: 'כחול', green: 'ירוק', purple: 'סגול', red: 'אדום', gray: 'אפור' };
function caretBox() {
  const s = window.getSelection(); if (!s.rangeCount) return null;
  const n = s.getRangeAt(0).startContainer; const el = n.nodeType === 1 ? n : n.parentElement;
  return el && $('editor').contains(el) ? el.closest('div[data-box]') : null;
}
function insertBox(color, afterBox) {
  restoreSelection();
  if (afterBox && afterBox.isConnected) {          // מסגרת חדשה מיד אחרי המסגרת שאתה נמצא בה
    const nb = document.createElement('div'); nb.setAttribute('data-box', color);
    const w = afterBox.getAttribute('data-w'); if (w) nb.setAttribute('data-w', w);   // מסגרת צרה: החדשה נכנסת לידה באותה שורה
    const p = document.createElement('p'); p.appendChild(document.createElement('br')); nb.appendChild(p);
    afterBox.after(nb); applyBoxSizes($('editor'));
    if (!nb.nextElementSibling) { const after = document.createElement('p'); after.appendChild(document.createElement('br')); nb.after(after); }
    placeCaret(p); markDirty(); return;
  }
  const s = window.getSelection(); const r = s.rangeCount ? s.getRangeAt(0) : null;
  const box = document.createElement('div'); box.setAttribute('data-box', color);
  // אם סימנת טקסט בתוך שורה אחת — הוא נכנס לתוך התיבה
  if (r && !r.collapsed && $('editor').contains(r.commonAncestorContainer)) {
    const p = document.createElement('p'); p.appendChild(r.extractContents()); box.appendChild(p);
    const B = blockOf(r.startContainer);
    if (B && !B.closest('div[data-box]')) { if (isEmpty(B)) B.replaceWith(box); else B.after(box); } else $('editor').appendChild(box);
  } else {
    const p = document.createElement('p'); p.appendChild(document.createElement('br')); box.appendChild(p);
    insertBlockAtCaret(box);
  }
  if (!box.nextElementSibling) { const after = document.createElement('p'); after.appendChild(document.createElement('br')); box.after(after); }
  placeCaret(box.querySelector('p') || box); markDirty();
}
function boxDialog(newAfter) {
  restoreSelection();
  const box = newAfter ? null : caretBox();
  dialog(d => {
    d.innerHTML = box ? '<h3>עריכת תיבת טקסט</h3><p>בחר צבע אחר, או הוצא את הטקסט מהתיבה.</p>' : '<h3>תיבת טקסט</h3><p>תיבה צבעונית להדגשת משהו חשוב: הגדרה, כלל, או "חשוב למבחן". אם סימנת טקסט, הוא ייכנס לתוך התיבה.</p>';
    const grid = document.createElement('div'); grid.className = 'box-pick';
    BOX_COLORS.forEach(c => {
      const b = document.createElement('button'); b.type = 'button'; b.setAttribute('data-box', c); b.className = 'box-swatch' + (box && box.getAttribute('data-box') === c ? ' on' : '');
      b.textContent = BOX_NAMES[c];
      b.onclick = () => { closeDialog(); if (box) { box.setAttribute('data-box', c); markDirty(); } else insertBox(c, newAfter); };
      grid.appendChild(b);
    });
    const row = document.createElement('div'); row.className = 'row';
    if (box) {
      const out = document.createElement('button'); out.className = 'btn btn-ghost'; out.textContent = 'הוצאת הטקסט מהתיבה';
      out.onclick = () => { closeDialog(); const kids = [...box.childNodes]; box.replaceWith(...kids); markDirty(); };
      const del = document.createElement('button'); del.className = 'btn btn-ghost'; del.textContent = 'מחיקת התיבה';
      del.onclick = () => { closeDialog(); box.remove(); markDirty(); };
      row.append(out, del);
    }
    const cancel = document.createElement('button'); cancel.className = 'btn btn-ghost'; cancel.textContent = 'ביטול'; cancel.onclick = closeDialog;
    row.appendChild(cancel); d.append(grid, row);
  });
}
$('boxBtn').addEventListener('click', () => {
  restoreSelection();
  const inBox = caretBox();
  dialog(d => {
    d.innerHTML = '<h3>תיבת טקסט</h3><p>מה להוסיף?</p>';
    const g = document.createElement('div'); g.className = 'kind-pick';
    g.innerHTML = '<button data-k="h1"><b style="font-size:22px">הוסף כותרת</b></button><button data-k="h2"><b style="font-size:17px">הוסף כותרת משנה</b></button><button data-k="body"><b style="font-weight:500">הוסף גוף טקסט</b><span>טקסט חופשי שמזיזים לכל מקום, מגדילים ומסובבים</span></button><button data-k="box"><b>🟨 מסגרת צבעונית חדשה</b><span>מסגרת בתוך הטקסט להדגשת משהו חשוב</span></button>' + (inBox ? '<button data-k="edit"><b>🎨 עריכת המסגרת שאתה נמצא בה</b><span>צבע אחר, הוצאת הטקסט או מחיקה</span></button>' : '');
    g.onclick = ev => { const b = ev.target.closest('button'); if (!b) return; closeDialog(); if (b.dataset.k === 'edit') boxDialog(); else if (b.dataset.k === 'box') boxDialog(inBox || undefined); else { if (inBox) { const s2 = getSelection(); const q = document.createElement('p'); q.appendChild(document.createElement('br')); inBox.after(q); const r2 = document.createRange(); r2.setStart(q, 0); s2.removeAllRanges(); s2.addRange(r2); savedRange = r2.cloneRange(); } addItem('x', b.dataset.k); } };
    const c = document.createElement('button'); c.className = 'btn btn-ghost'; c.textContent = 'ביטול'; c.onclick = closeDialog;
    d.append(g, c);
  });
});
// Enter פעמיים בסוף תיבה (שורה ריקה) = יציאה מהתיבה
$('editor').addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.shiftKey) return;
  const box = caretBox(); if (!box) return;
  const s = window.getSelection(); const B = blockOf(s.getRangeAt(0).startContainer);
  if (B && B !== box && B.parentElement === box && isEmpty(B) && B === box.lastElementChild && box.children.length > 1) {
    e.preventDefault(); B.remove();
    const p = document.createElement('p'); p.appendChild(document.createElement('br')); box.after(p); placeCaret(p); markDirty();
  }
});


/* ===== שינוי גודל לתיבת טקסט: ידית בפינה ===== */
function applyBoxSizes(root) {
  root.querySelectorAll('div[data-box]').forEach(b => {
    const w = b.getAttribute('data-w'), h = b.getAttribute('data-h');
    b.style.width = w && w !== '100' ? w + '%' : '';
    b.style.minHeight = h ? h + 'px' : '';
    const x = b.getAttribute('data-x'); b.style.marginRight = x ? x + '%' : '';
  });
}
const boxHandle = document.createElement('div');
boxHandle.className = 'box-handle hidden'; boxHandle.title = 'גרור כדי לשנות את גודל התיבה';
boxHandle.innerHTML = '<svg viewBox="0 0 24 24"><path d="M5 19 19 5M11 19l8-8M17 19l2-2"/></svg>';
document.querySelector('#notebook .page').appendChild(boxHandle);
let hBox = null, boxDrag = null;
function placeHandle(box) {
  hBox = box;
  if (!box || !box.isConnected) { boxHandle.classList.add('hidden'); return; }
  const page = boxHandle.parentElement.getBoundingClientRect(), r = box.getBoundingClientRect();
  boxHandle.style.left = (r.left - page.left - 11) + 'px';      // פינה שמאלית-תחתונה (התיבה מיושרת לימין)
  boxHandle.style.top = (r.bottom - page.top - 11) + 'px';
  boxHandle.classList.remove('hidden');
}
$('editor').addEventListener('pointerover', e => { if (boxDrag) return; const b = e.target.closest('div[data-box]'); if (b) placeHandle(b); });
document.addEventListener('selectionchange', () => { if (boxDrag) return; const b = caretBox(); if (b) placeHandle(b); });
$('editor').addEventListener('input', () => { if (hBox) placeHandle(hBox); });
window.addEventListener('resize', () => { if (hBox) placeHandle(hBox); });
document.addEventListener('pointerdown', e => {
  if (e.target.closest('.box-handle') || e.target.closest('div[data-box]')) return;
  if (!boxDrag) placeHandle(null);
});
boxHandle.addEventListener('pointerdown', e => {
  if (!hBox) return; e.preventDefault();
  const r = hBox.getBoundingClientRect(), ed = $('editor').getBoundingClientRect();
  boxDrag = { box: hBox, right: r.right, top: r.top, edW: ed.width, id: e.pointerId };
  boxHandle.setPointerCapture(e.pointerId); boxHandle.classList.add('active'); hBox.classList.add('resizing');
});
boxHandle.addEventListener('pointermove', e => {
  if (!boxDrag || e.pointerId !== boxDrag.id) return;
  const { box, right, top, edW } = boxDrag;
  let w = Math.round((right - e.clientX) / edW * 100); w = Math.max(15, Math.min(100, w));
  if (w > 96) w = 100;                                              // הצמדה לרוחב מלא
  const content = [...box.children].reduce((h, c) => h + c.getBoundingClientRect().height, 0) + 28;
  let h = Math.round(e.clientY - top); h = Math.max(40, h);
  box.setAttribute('data-w', String(w));
  if (h > content + 8) box.setAttribute('data-h', String(h)); else box.removeAttribute('data-h');
  applyBoxSizes(box.parentElement || $('editor'));
  placeHandle(box);
});
function endBoxDrag(e) {
  if (!boxDrag || e.pointerId !== boxDrag.id) return;
  boxDrag.box.classList.remove('resizing'); boxHandle.classList.remove('active');
  if (boxDrag.box.getAttribute('data-w') === '100') boxDrag.box.removeAttribute('data-w');
  boxDrag = null; markDirty();
}
boxHandle.addEventListener('pointerup', endBoxDrag);
boxHandle.addEventListener('pointercancel', endBoxDrag);


/* ===== הזזה של מסגרת צבעונית ימינה/שמאלה ===== */
const boxMove = document.createElement('div');
boxMove.className = 'box-move hidden'; boxMove.title = 'גרור כדי להזיז את התיבה';
boxMove.innerHTML = '<svg viewBox="0 0 24 24"><path d="M5 9l-3 3 3 3M19 9l3 3-3 3M9 5l3-3 3 3M9 19l3 3 3-3M2 12h20M12 2v20"/></svg>';
document.querySelector('#notebook .page').appendChild(boxMove);
let moveDrag = null;
const _placeHandle = placeHandle;
placeHandle = function (box) {
  _placeHandle(box);
  if (!box || !box.isConnected) { boxMove.classList.add('hidden'); return; }
  const page = boxMove.parentElement.getBoundingClientRect(), r = box.getBoundingClientRect();
  boxMove.style.left = (r.left + r.width / 2 - page.left - 22) + 'px';
  boxMove.style.top = (r.top - page.top - 14) + 'px';
  boxMove.classList.remove('hidden');
};
document.addEventListener('pointerdown', e => { if (!e.target.closest('.box-move,.box-handle,div[data-box]') && !moveDrag) boxMove.classList.add('hidden'); });
boxMove.addEventListener('pointerdown', e => {
  if (!hBox) return; e.preventDefault();
  const ed = $('editor').getBoundingClientRect(), r = hBox.getBoundingClientRect();
  moveDrag = { box: hBox, edRight: ed.right, edW: ed.width, grab: r.right - e.clientX, w: r.width, id: e.pointerId, y0: e.clientY };
  boxMove.setPointerCapture(e.pointerId); boxMove.classList.add('active'); hBox.classList.add('resizing');
});
const dropLine = document.createElement('div'); dropLine.className = 'drop-line hidden';
document.querySelector('#notebook .page').appendChild(dropLine);
boxMove.addEventListener('pointermove', e => {
  if (!moveDrag || e.pointerId !== moveDrag.id) return;
  const { box, edRight, edW, grab, w } = moveDrag;
  // ימינה / שמאלה
  const maxX = Math.max(0, Math.round((edW - w) / edW * 100));
  let x = Math.round((edRight - (e.clientX + grab)) / edW * 100); x = Math.max(0, Math.min(maxX, x));
  if (Math.abs(x - maxX / 2) <= 2) x = Math.round(maxX / 2);           // הצמדה לאמצע
  if (x <= 1) box.removeAttribute('data-x'); else box.setAttribute('data-x', String(Math.min(85, x)));
  applyBoxSizes(box.parentElement || $('editor'));
  // למעלה / למטה: איפה התיבה תעבור בין השורות
  const ed = $('editor'), page = dropLine.parentElement.getBoundingClientRect();
  const sibs = [...ed.children].filter(c => c !== box);
  let target = null, before = true;
  // ליד תיבה אחרת באותה שורה (כשהאצבע נמצאת על תיבה אחרת)
  const over = sibs.find(c => c.matches('div[data-box]') && (() => { const r = c.getBoundingClientRect(); return e.clientY >= r.top && e.clientY <= r.bottom; })());
  if (over) {
    const r = over.getBoundingClientRect(), right = e.clientX > r.left + r.width / 2;   // ימין = לפני (עברית)
    moveDrag.side = over; moveDrag.sideBefore = right; moveDrag.target = null;
    const pg = dropLine.parentElement.getBoundingClientRect();
    dropLine.classList.add('vert'); dropLine.style.left = ((right ? r.right + 4 : r.left - 6) - pg.left) + 'px';
    dropLine.style.top = (r.top - pg.top) + 'px'; dropLine.style.width = ''; dropLine.style.height = r.height + 'px';
    dropLine.classList.remove('hidden');
    box.style.transform = `translateY(${e.clientY - moveDrag.y0}px)`; placeHandle(box);
    return;
  }
  moveDrag.side = null; dropLine.classList.remove('vert'); dropLine.style.height = '';
  for (const c of sibs) { const r = c.getBoundingClientRect(); if (e.clientY < r.top + r.height / 2) { target = c; before = true; break; } }
  if (!target && sibs.length) { target = sibs[sibs.length - 1]; before = false; }
  const same = target && ((before && target === box.nextElementSibling) || (!before && target === box.previousElementSibling));
  moveDrag.target = same ? null : target; moveDrag.before = before;
  if (moveDrag.target) {
    const r = target.getBoundingClientRect(), y = before ? r.top - 4 : r.bottom + 4, er = ed.getBoundingClientRect();
    dropLine.style.top = (y - page.top - 1.5) + 'px'; dropLine.style.left = (er.left - page.left) + 'px'; dropLine.style.width = er.width + 'px';
    dropLine.classList.remove('hidden');
  } else dropLine.classList.add('hidden');
  // התיבה זזה עם האצבע/העכבר בזמן הגרירה
  box.style.transform = `translateY(${e.clientY - moveDrag.y0}px)`;
  placeHandle(box);
});
function endMove(e) {
  if (!moveDrag || e.pointerId !== moveDrag.id) return;
  const { box, target, before } = moveDrag;
  box.style.transform = ''; dropLine.classList.add('hidden'); dropLine.classList.remove('vert'); dropLine.style.height = '';
  const side = moveDrag.side;
  if (side && side.isConnected) {
    // שתי תיבות באותה שורה: מצמצמים כך ששתיהן ייכנסו
    const wOf = b => +(b.getAttribute('data-w') || 100);
    if (wOf(side) + wOf(box) > 97) { const half = '48'; side.setAttribute('data-w', half); box.setAttribute('data-w', half); }
    side.removeAttribute('data-x'); box.removeAttribute('data-x');
    moveDrag.sideBefore ? side.before(box) : side.after(box);
    applyBoxSizes($('editor'));
  } else if (target && target.isConnected) { before ? target.before(box) : target.after(box); }
  box.classList.remove('resizing'); boxMove.classList.remove('active'); moveDrag = null; markDirty();
  placeHandle(box);
}
boxMove.addEventListener('pointerup', endMove);
boxMove.addEventListener('pointercancel', endMove);


/* ================= יישור טקסט: ימין / מרכז / שמאל ================= */
function alignBlocks(dir) {
  restoreSelection(); wrapLoose && wrapLoose();
  const s = window.getSelection(); if (!s.rangeCount) return;
  const r = s.getRangeAt(0); const ed = $('editor');
  let blocks = [...ed.querySelectorAll('p,h1,h2,h3,li')].filter(el => r.intersectsNode(el) && !el.closest('.cv') && !el.querySelector('p,h1,h2,h3,li'));
  if (!blocks.length) { const B = blockOf(r.startContainer); if (B && /^(P|H1|H2|H3|LI)$/.test(B.tagName)) blocks = [B]; }
  if (!blocks.length) return;
  blocks.forEach(b => { if (dir === 'right') b.removeAttribute('data-a'); else b.setAttribute('data-a', dir); });
  updateAlignButtons(); markDirty();
}
function updateAlignButtons() {
  const s = window.getSelection(); let cur = 'right';
  if (s.rangeCount && $('editor').contains(s.anchorNode)) { const B = blockOf(s.anchorNode); if (B && B.getAttribute('data-a')) cur = B.getAttribute('data-a'); }
  document.querySelectorAll('[data-align]').forEach(b => b.classList.toggle('on', b.dataset.align === cur));
}
document.querySelectorAll('[data-align]').forEach(b => b.addEventListener('click', () => alignBlocks(b.dataset.align)));
document.addEventListener('selectionchange', updateAlignButtons);

// גופן וגודל בסרגל העליון
$('editor').addEventListener('change', e => {
  const c = e.target.closest('.cv-bar select, .cv-bar input'); if (!c) return;
  const el = c.closest('.cv'); const o = cvData(el); const it = o.items[selIdx]; if (!it || it.lk) return;
  if (c.dataset.a === 'font') it.f = c.value;
  if (c.dataset.a === 'size') it.s = Math.max(8, Math.min(120, +c.value || it.s));
  cvSave(el, o); drawCv(el);
});
$('editor').addEventListener('keydown', e => { if (e.target.closest('.cv-bar input')) { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); } }, true);

/* ===== תזכורות בדפדפן: מבחנים ומשימות של היום ומחר ===== */
const canNotify = 'Notification' in window;
function bellState() {
  const b = $('bellBtn'); if (!b) return;
  if (!canNotify) { b.classList.add('hidden'); return; }
  const on = Notification.permission === 'granted';
  b.classList.toggle('on', on); b.textContent = on ? '🔔 תזכורות פועלות' : '🔔 הפעלת תזכורות';
  b.title = on ? 'כשהאתר נפתח תקבל התראה על מבחנים ומשימות של היום ומחר' : 'קבל התראה על מבחנים ומשימות קרובים';
}
async function remind(force) {
  if (!canNotify || Notification.permission !== 'granted' || !me) return;
  const tk = todayKey(), t2 = new Date(); t2.setDate(t2.getDate() + 1); const tm = key(t2);
  const flag = 'reminded-' + me.uid + '-' + tk;
  try { if (!force && localStorage.getItem(flag)) return; } catch {}
  const soon = events.filter(e => !e.done && (e.date === tk || e.date === tm));
  if (!soon.length) { if (force) toast('אין מבחנים או משימות להיום ולמחר'); return; }
  try { localStorage.setItem(flag, '1'); } catch {}
  const line = e => `${e.date === tk ? 'היום' : 'מחר'}: ${TYPE_NAME[e.type] || 'אחר'} – ${e.title}${e.time ? ' (' + e.time + ')' : ''}`;
  const tests = soon.filter(e => e.type === 'test');
  const title = tests.length ? (tests.length === 1 ? 'יש לך מבחן קרוב 📚' : `יש לך ${tests.length} מבחנים קרובים 📚`) : 'תזכורת מהמחברות שלי';
  const opts = { body: soon.slice(0, 4).map(line).join('\n'), icon: 'icon-192.png', badge: 'icon-192.png', tag: 'daily-' + tk, lang: 'he', dir: 'rtl' };
  try { const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration(); if (reg) reg.showNotification(title, opts); else new Notification(title, opts); }
  catch { try { new Notification(title, opts); } catch {} }
}
if ($('bellBtn')) $('bellBtn').onclick = async () => {
  if (!canNotify) return;
  if (Notification.permission === 'denied') { toast('ההתראות חסומות. אפשר להפעיל אותן בהגדרות האתר בדפדפן'); return; }
  if (Notification.permission !== 'granted') await Notification.requestPermission();
  bellState();
  if (Notification.permission === 'granted') remind(true);
};
bellState();

/* ===== אפליקציה במסך הבית + עבודה בלי אינטרנט ===== */
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(e => console.warn('sw', e));

/* ===== חיווי כשאין אינטרנט ===== */
function netState() {
  const off = !navigator.onLine;
  $('offline').classList.toggle('hidden', !off);
  if (!off && $('save').dataset.st === 'off') setSave('מסנכרן...', 'busy');
}
window.addEventListener('online', () => { netState(); toast('האינטרנט חזר. השינויים נשלחים לענן'); });
window.addEventListener('offline', () => { netState(); toast('אין אינטרנט. אפשר להמשיך לכתוב, הכל נשמר במכשיר'); });
netState();

/* ===== גיבוי ושחזור: כל המחברות, התמונות והיומן בקובץ אחד ===== */
async function downloadBackup() {
  $('userMenu').classList.add('hidden');
  if (dirty) await flush();
  toast('מכין את הגיבוי...');
  try {
    const all = async name => (await getDocs(collection(db, 'users', me.uid, name))).docs.map(d => ({ id: d.id, ...d.data() }));
    const [nbs, evs, imgs] = await Promise.all([all('notebooks'), all('events'), all('images')]);
    const data = { app: 'my-notebooks', version: 1, exportedAt: new Date().toISOString(), notebooks: nbs, events: evs, images: imgs };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `my_notebooks_backup_${todayKey()}.json`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast(`הגיבוי ירד: ${nbs.length} מחברות, ${evs.length} אירועים ביומן`);
  } catch (e) { console.error(e); toast('הגיבוי נכשל. בדוק שיש אינטרנט ונסה שוב'); }
}
function restoreBackup() {
  $('userMenu').classList.add('hidden');
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    let data;
    try { data = JSON.parse(await f.text()); } catch { toast('הקובץ הזה לא גיבוי תקין'); return; }
    if (!data || data.app !== 'my-notebooks' || !Array.isArray(data.notebooks)) { toast('הקובץ הזה לא גיבוי של המחברות שלי'); return; }
    const okId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);
    const nbs = data.notebooks.filter(n => okId(n.id) && typeof n.html === 'string').slice(0, 500);
    const evs = (data.events || []).filter(e => okId(e.id) && /^\d{4}-\d{2}-\d{2}$/.test(e.date || '') && typeof e.title === 'string').slice(0, 5000);
    const imgs = (data.images || []).filter(i => okId(i.id) && typeof i.data === 'string' && /^data:image\/(png|jpe?g|webp|gif);base64,/.test(i.data) && i.data.length < 950000).slice(0, 2000);
    const when = data.exportedAt ? new Date(data.exportedAt).toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
    dialog(d => {
      d.innerHTML = `<h3>שחזור מגיבוי</h3><p>בקובץ${when ? ` (מ־${when})` : ''}: <b>${nbs.length}</b> מחברות, <b>${evs.length}</b> אירועים ביומן ו־<b>${imgs.length}</b> תמונות.</p><p>מחברות שקיימות גם עכשיו יחזרו לגרסה שבגיבוי. מחברות חדשות שאינן בגיבוי לא יימחקו.</p>`;
      const row = document.createElement('div'); row.className = 'row';
      const go = document.createElement('button'); go.className = 'btn btn-primary'; go.textContent = 'לשחזר';
      const no = document.createElement('button'); no.className = 'btn btn-ghost'; no.textContent = 'ביטול'; no.onclick = closeDialog;
      go.onclick = async () => {
        go.disabled = true; go.textContent = 'משחזר...';
        try {
          const uid = me.uid;
          for (const i of imgs) await setDoc(doc(db, 'users', uid, 'images', i.id), { data: i.data, createdAt: +i.createdAt || Date.now() });
          for (const n of nbs) await setDoc(doc(db, 'users', uid, 'notebooks', n.id), { title: String(n.title || 'מחברת ללא שם').slice(0, 200), html: clean(n.html), color: typeof n.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(n.color) ? n.color : COLORS[0], createdAt: +n.createdAt || Date.now(), updatedAt: +n.updatedAt || Date.now() });
          for (const e of evs) await setDoc(doc(db, 'users', uid, 'events', e.id), { title: e.title.slice(0, 300), date: e.date, time: typeof e.time === 'string' ? e.time.slice(0, 5) : '', type: ['test', 'hw', 'event', 'other'].includes(e.type) ? e.type : 'other', done: !!e.done, createdAt: +e.createdAt || Date.now() });
          closeDialog(); toast('השחזור הושלם ✓');
          if (openId) { const n = nbs.find(x => x.id === openId); if (n) showLibrary(); }
        } catch (err) { console.error(err); go.disabled = false; go.textContent = 'לשחזר'; toast('השחזור נכשל באמצע. אפשר לנסות שוב, זה בטוח'); }
      };
      row.append(go, no); d.appendChild(row);
    });
  };
  inp.click();
}
$('backupBtn').onclick = downloadBackup;
$('restoreBtn').onclick = restoreBackup;

/* ================= שיתוף עם חברים ================= */
// כל מחברת משותפת מקבלת עותק חי ב-shares/<קוד>; מי שיש לו את הקישור יכול לקרוא אותו
let trash = [];
let unsubSh = null, unsubView = null, sharedList = [];
let shareParam = new URLSearchParams(location.search).get('s');
if (shareParam && !/^[A-Za-z0-9]{3,40}$/.test(shareParam)) shareParam = null;
const shareDoc = id => doc(db, 'shares', id);
const shareUrl = id => location.origin + location.pathname.replace(/index\.html$/, '') + '?s=' + id;

const SHARE_MODES = { view: ['👁️ צפייה בלבד', 'החבר רק קורא. אין כפתורים, אי אפשר לשמור עותק ואי אפשר לשנות כלום.'], copy: ['📥 צפייה + שמירת עותק', 'החבר קורא, ויכול לשמור לעצמו עותק משלו ולערוך אותו. המחברת שלך לא משתנה.'] };
function modePicker(cur, onPick) {
  const g = document.createElement('div'); g.className = 'mode-pick'; g.setAttribute('role', 'radiogroup');
  Object.entries(SHARE_MODES).forEach(([k, [t, d]]) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'mode' + (k === cur ? ' on' : ''); b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', k === cur);
    b.innerHTML = `<b>${t}</b><span>${d}</span>`;
    b.onclick = () => { [...g.children].forEach(x => { x.classList.remove('on'); x.setAttribute('aria-checked', 'false'); }); b.classList.add('on'); b.setAttribute('aria-checked', 'true'); onPick(k); };
    g.appendChild(b);
  });
  return g;
}
function shareDialog() {
  const n = notebooks.find(x => x.id === openId); if (!n) return;
  dialog(d => {
    const paint = () => {
      const cur = notebooks.find(x => x.id === openId) || n;
      if (!cur.shareId) {
        d.innerHTML = '<h3>שיתוף עם חברים</h3><p>יוצרים קישור ושולחים אותו לחברים. מה מותר להם?</p>';
        let mode = 'view'; d.appendChild(modePicker(mode, m => mode = m));
        d.insertAdjacentHTML('beforeend', '<p class="muted-s">בשתי האפשרויות אף אחד לא יכול לשנות את המחברת שלך, וכל שינוי שתעשה יופיע אצלם לבד.</p>');
        const row = document.createElement('div'); row.className = 'row';
        const go = document.createElement('button'); go.className = 'btn btn-primary'; go.textContent = 'יצירת קישור';
        go.onclick = async () => {
          go.disabled = true; go.textContent = 'יוצר...';
          try {
            if (dirty) await flush();
            const ref = doc(collection(db, 'shares'));
            const nn = notebooks.find(x => x.id === openId) || n;
            await setDoc(ref, { owner: me.uid, ownerName: me.displayName || (me.email || '').split('@')[0] || 'חבר', nb: nn.id, title: $('title').value.trim() || nn.title || 'מחברת', html: clean($('editor').innerHTML), color: nn.color || COLORS[0], mode, createdAt: Date.now(), updatedAt: Date.now() });
            nn.shareMode = mode;
            await updateDoc(nbDoc(nn.id), { shareId: ref.id, shareMode: mode });
            nn.shareId = ref.id; paint();
          } catch (e) { console.error(e); go.disabled = false; go.textContent = 'יצירת קישור'; toast(e && e.code === 'permission-denied' ? 'צריך לעדכן את כללי האבטחה ב-Firebase (ראה README)' : 'לא הצלחתי ליצור קישור'); }
        };
        const no = document.createElement('button'); no.className = 'btn btn-ghost'; no.textContent = 'ביטול'; no.onclick = closeDialog;
        row.append(go, no); d.appendChild(row);
      } else {
        const url = shareUrl(cur.shareId);
        d.innerHTML = '<h3>המחברת משותפת ✓</h3><p>שלח את הקישור לחברים. הם יראו תמיד את הגרסה העדכנית.</p>';
        const cm = cur.shareMode || 'copy';
        d.appendChild(modePicker(cm, async m => {
          try { await updateDoc(shareDoc(cur.shareId), { mode: m }); await updateDoc(nbDoc(cur.id), { shareMode: m }); cur.shareMode = m; toast(m === 'view' ? 'עכשיו: צפייה בלבד' : 'עכשיו: צפייה + שמירת עותק'); }
          catch (e) { console.error(e); toast('לא הצלחתי לשנות'); }
        }));
        const box = document.createElement('div'); box.className = 'share-link';
        const inp = document.createElement('input'); inp.readOnly = true; inp.value = url; inp.dir = 'ltr'; inp.onclick = () => inp.select();
        const cp = document.createElement('button'); cp.className = 'btn btn-primary'; cp.textContent = 'העתקה';
        cp.onclick = async () => { try { await navigator.clipboard.writeText(url); cp.textContent = 'הועתק ✓'; } catch { inp.select(); document.execCommand('copy'); cp.textContent = 'הועתק ✓'; } };
        box.append(inp, cp); d.appendChild(box);
        const row = document.createElement('div'); row.className = 'row';
        if (navigator.share) { const sh = document.createElement('button'); sh.className = 'btn btn-ghost'; sh.textContent = '📤 שליחה...'; sh.onclick = () => navigator.share({ title: cur.title || 'מחברת', text: `המחברת "${$('title').value || cur.title}" שלי`, url }).catch(() => {}); row.appendChild(sh); }
        const wa = document.createElement('a'); wa.className = 'btn btn-ghost'; wa.target = '_blank'; wa.rel = 'noopener'; wa.textContent = 'וואטסאפ'; wa.href = 'https://wa.me/?text=' + encodeURIComponent(`המחברת "${$('title').value || cur.title}" שלי: ${url}`); row.appendChild(wa);
        const stop = document.createElement('button'); stop.className = 'btn btn-ghost danger-t'; stop.textContent = 'הפסקת שיתוף';
        stop.onclick = async () => {
          try { await deleteDoc(shareDoc(cur.shareId)); await updateDoc(nbDoc(cur.id), { shareId: null }); cur.shareId = null; toast('הקישור בוטל. מי שקיבל אותו כבר לא יכול לפתוח את המחברת'); closeDialog(); }
          catch (e) { console.error(e); toast('לא הצלחתי לבטל'); }
        };
        const close = document.createElement('button'); close.className = 'btn btn-ghost'; close.textContent = 'סגירה'; close.onclick = closeDialog;
        row.append(stop, close); d.appendChild(row);
      }
    };
    paint();
  });
}
$('shareBtn').onclick = shareDialog;

// ---- צפייה במחברת שמישהו שיתף
function openShare(id) {
  shareParam = id;
  if (!location.search.includes('s=' + id)) history.pushState({ s: id }, '', '?s=' + id);
  const v = $('shareView'); v.classList.remove('hidden'); document.body.classList.add('viewing-share');
  $('shBody').innerHTML = '<div class="skel-grid"><div class="skel"><i></i><b></b><b></b></div></div>';
  $('shTitle').textContent = ''; $('shOwner').textContent = '';
  if (unsubView) unsubView();
  unsubView = onSnapshot(shareDoc(id), snap => {
    if (!snap.exists()) { $('shTitle').textContent = 'המחברת לא זמינה'; $('shOwner').textContent = ''; $('shBody').innerHTML = '<p class="sh-empty">הקישור הזה בוטל, או שהמחברת נמחקה.</p>'; $('shCopy').classList.add('hidden'); if (me) deleteDoc(doc(db, 'users', me.uid, 'shared', id)).catch(() => {}); return; }
    const s = snap.data(); const mine = me && s.owner === me.uid; const viewOnly = (s.mode || 'copy') === 'view';
    $('shareView').classList.toggle('view-only', viewOnly && !mine);
    document.title = (s.title || 'מחברת') + ' · המחברות שלי';
    $('shTitle').textContent = s.title || 'מחברת';
    $('shOwner').textContent = mine ? `זו המחברת שלך. ככה החברים רואים אותה (${viewOnly ? 'צפייה בלבד' : 'צפייה + שמירת עותק'})` : `שותף על ידי ${s.ownerName || 'חבר'} · עודכן ${timeAgo(s.updatedAt)}${viewOnly ? ' · צפייה בלבד' : ''}`;
    $('shColor').style.setProperty('--c', s.color || COLORS[0]);
    const b = $('shBody'); b.innerHTML = clean(s.html || '');
    loadImages(b, s.owner); renderFiles(b, s.owner, true); renderCanvases(b); applyBoxSizes(b);
    const cp = $('shCopy'); cp.classList.toggle('hidden', viewOnly && !mine);
    cp.textContent = mine ? 'פתיחה לעריכה' : (me ? '📥 שמירת עותק אצלי' : 'התחברות כדי לשמור עותק');
    cp.onclick = () => mine ? (closeShare(), openNotebook(s.nb)) : (me ? copyShare(id, s) : closeShare());
    if (me && !mine) setDoc(doc(db, 'users', me.uid, 'shared', id), { title: s.title || 'מחברת', ownerName: s.ownerName || '', color: s.color || COLORS[0], openedAt: Date.now() }).catch(() => {});
  }, err => { console.error(err); $('shTitle').textContent = 'לא הצלחתי לפתוח את המחברת'; $('shBody').innerHTML = '<p class="sh-empty">' + (err.code === 'permission-denied' ? 'הקישור לא תקין, או שהשיתוף בוטל.' : 'בדוק שיש אינטרנט ונסה שוב.') + '</p>'; $('shCopy').classList.add('hidden'); });
}
function closeShare() {
  if (unsubView) { unsubView(); unsubView = null; }
  shareParam = null; $('shareView').classList.add('hidden'); document.body.classList.remove('viewing-share');
  document.title = 'המחברות שלי';
  if (location.search) history.replaceState(null, '', location.pathname);
}
$('shClose').onclick = closeShare;
window.addEventListener('popstate', () => { const s = new URLSearchParams(location.search).get('s'); if (s) openShare(s); else if (!$('shareView').classList.contains('hidden')) closeShare(); });

async function copyShare(id, s) {
  if ((s.mode || 'copy') === 'view') return;
  const cp = $('shCopy'); cp.disabled = true; cp.textContent = 'שומר...';
  try {
    const html = clean(s.html || '');
    // מעתיקים גם את התמונות, כדי שהעותק יהיה שלך לגמרי
    const ids = [...html.matchAll(/data-img="([A-Za-z0-9_-]+)"/g)].map(m => m[1]);
    for (const iid of ids) {
      const src = await getDoc(imgDoc(iid, s.owner));
      if (src.exists()) await setDoc(imgDoc(iid), { data: src.data().data, createdAt: Date.now() });
    }
    const ref = doc(nbCol()); const now = Date.now();
    await setDoc(ref, { title: s.title || 'מחברת', color: s.color || COLORS[0], html, createdAt: now, updatedAt: now });
    toast('נשמר עותק במחברות שלך ✓');
    closeShare(); setTimeout(() => openNotebook(ref.id), 300);
  } catch (e) { console.error(e); toast('לא הצלחתי לשמור עותק'); }
  cp.disabled = false;
}

// ---- רשימת "שותפו איתי"
function subscribeShared() {
  unsubSh = onSnapshot(collection(db, 'users', me.uid, 'shared'), snap => {
    sharedList = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0));
    renderShared();
  }, err => console.warn('shared', err));
}
function renderShared() {
  const box = $('sharedWithMe'); if (!box) return;
  box.classList.toggle('hidden', !sharedList.length);
  const list = $('sharedList'); list.innerHTML = '';
  sharedList.forEach(x => {
    const b = document.createElement('button'); b.className = 'sh-item'; b.style.setProperty('--c', x.color || COLORS[0]);
    const t = document.createElement('b'); t.textContent = x.title || 'מחברת';
    const o = document.createElement('small'); o.textContent = x.ownerName ? 'מאת ' + x.ownerName : '';
    const rm = document.createElement('span'); rm.className = 'rm'; rm.textContent = '✕'; rm.title = 'הסרה מהרשימה';
    rm.onclick = ev => { ev.stopPropagation(); deleteDoc(doc(db, 'users', me.uid, 'shared', x.id)).catch(() => {}); };
    b.append(t, o, rm); b.onclick = () => openShare(x.id); list.appendChild(b);
  });
}
if (shareParam) openShare(shareParam);

/* ===== פח מחזור ===== */
const TRASH_DAYS = 30;
function purgeTrash() {
  const lim = Date.now() - TRASH_DAYS * 864e5;
  trash.filter(n => n.trashed < lim).forEach(n => deleteDoc(nbDoc(n.id)).catch(() => {}));
}
function renderTrashBtn() {
  const b = $('trashBtn'); if (!b) return;
  b.classList.toggle('hidden', !trash.length);
  b.querySelector('span').textContent = `פח מחזור (${trash.length})`;
}
function trashDialog() {
  dialog(d => {
    const paint = () => {
      d.innerHTML = `<h3>פח מחזור</h3><p class="muted-s">מחברות נמחקות לגמרי ${TRASH_DAYS} יום אחרי שהועברו לפח.</p>`;
      if (!trash.length) { d.insertAdjacentHTML('beforeend', '<p class="noev">הפח ריק.</p>'); }
      const list = document.createElement('div'); list.className = 'trash-list';
      trash.forEach(n => {
        const left = Math.max(1, TRASH_DAYS - Math.floor((Date.now() - n.trashed) / 864e5));
        const r = document.createElement('div'); r.className = 'trash-item'; r.style.setProperty('--c', n.color || COLORS[0]);
        const t = document.createElement('div'); t.className = 't';
        const b = document.createElement('b'); b.textContent = n.title || 'מחברת';
        const sm = document.createElement('small'); sm.textContent = left === 1 ? 'נמחקת מחר' : `עוד ${left} ימים`;
        t.append(b, sm);
        const res = document.createElement('button'); res.className = 'btn btn-ghost'; res.textContent = '↩︎ החזרה';
        res.onclick = async () => { await updateDoc(nbDoc(n.id), { trashed: null, updatedAt: Date.now() }).catch(() => toast('לא הצלחתי להחזיר')); trash = trash.filter(x => x.id !== n.id); toast('המחברת חזרה ✓'); paint(); };
        const del = document.createElement('button'); del.className = 'btn btn-ghost danger-t'; del.textContent = 'מחיקה לתמיד';
        del.onclick = async () => { if (del.dataset.sure) { await deleteDoc(nbDoc(n.id)).catch(() => toast('המחיקה נכשלה')); trash = trash.filter(x => x.id !== n.id); paint(); } else { del.dataset.sure = 1; del.textContent = 'בטוח? לחץ שוב'; } };
        r.append(t, res, del); list.appendChild(r);
      });
      d.appendChild(list);
      const row = document.createElement('div'); row.className = 'row';
      if (trash.length > 1) { const all = document.createElement('button'); all.className = 'btn btn-ghost danger-t'; all.textContent = 'ריקון הפח';
        all.onclick = async () => { if (!all.dataset.sure) { all.dataset.sure = 1; all.textContent = `למחוק ${trash.length} מחברות לתמיד?`; return; } for (const n of trash) await deleteDoc(nbDoc(n.id)).catch(() => {}); trash = []; paint(); };
        row.appendChild(all); }
      const c = document.createElement('button'); c.className = 'btn btn-ghost'; c.textContent = 'סגירה'; c.onclick = closeDialog; row.appendChild(c);
      d.appendChild(row);
    };
    paint();
  });
}
$('trashBtn').onclick = trashDialog;

/* ===== סטטיסטיקה: רצף, מילים, משימות ===== */
let activity = {}, unsubAct = null;
const actDoc = () => doc(db, 'users', me.uid, 'meta', 'activity');
const countWords = html => { const t = document.createElement('div'); t.innerHTML = html; return (t.textContent.match(/[\p{L}\p{N}]+/gu) || []).length; };
function trackWords(nb, html) {
  const w = countWords(html), prev = typeof nb.words === 'number' ? nb.words : (nb.html ? countWords(nb.html) : 0);
  nb.words = w;
  const delta = prev === null ? 0 : w - prev;           // מחברת ישנה בלי ספירה: רק מתחילים לספור
  const tk = todayKey();
  if (delta > 0) setDoc(actDoc(), { days: { [tk]: increment(delta) } }, { merge: true }).catch(() => {});
  else if (!activity[tk]) setDoc(actDoc(), { days: { [tk]: increment(0) } }, { merge: true }).catch(() => {});   // נכנסת ועבדת היום
  return w;
}
function subscribeActivity() {
  if (unsubAct) unsubAct();
  unsubAct = onSnapshot(actDoc(), snap => { activity = (snap.exists() && snap.data().days) || {}; if (!$('home').classList.contains('hidden')) renderStats(); }, () => {});
}
function streak() {
  const d = new Date(); let n = 0;
  if (activity[key(d)] === undefined) d.setDate(d.getDate() - 1);   // עוד לא עבדת היום: הרצף של אתמול עדיין חי
  while (activity[key(d)] !== undefined) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
function renderStats() {
  const c = $('statsCard'); if (!c) return;
  const days = []; for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); days.push(d); }
  const vals = days.map(d => activity[key(d)] || 0), max = Math.max(10, ...vals), week = vals.reduce((a, b) => a + b, 0);
  const from = key(days[0]), tk = todayKey();
  const doneWeek = events.filter(e => e.done && e.date >= from && e.date <= tk).length;
  const st = streak();
  c.innerHTML = `<h3>השבוע שלך</h3>
    <div class="stats">
      <div class="stat"><span class="n">${st}${st ? ' 🔥' : ''}</span><span class="l">${st === 1 ? 'יום ברצף' : 'ימים ברצף'}</span></div>
      <div class="stat"><span class="n">${week.toLocaleString('he-IL')}</span><span class="l">מילים כתבת השבוע</span></div>
      <button type="button" class="stat stat-link" data-go="cal" title="המשימות הן מה שיש לך ביומן: מבחנים, שיעורי בית ואירועים. מסמנים ✓ כשמסיימים"><span class="n">${doneWeek}</span><span class="l">משימות ביומן שסימנת ✓</span></button>
    </div>
    <div class="bars" role="img" aria-label="מילים בכל יום בשבוע האחרון">${days.map((d, i) => `<div class="bar${key(d) === tk ? ' today' : ''}" title="${vals[i]} מילים"><i style="height:${Math.max(vals[i] ? 6 : 2, Math.round(vals[i] / max * 100))}%"></i><span>${'אבגדהוש'[d.getDay()]}'</span></div>`).join('')}</div>
    <p class="muted-s">${st >= 2 ? `כל הכבוד! ${st} ימים ברצף שאתה כותב. אל תשבור את הרצף 💪` : st === 1 ? 'התחלת רצף. תכתוב משהו גם מחר כדי להמשיך אותו.' : 'תכתוב משהו במחברת היום כדי להתחיל רצף.'}</p>`;
}

/* ===== שרבוט: ציור חופשי שנשמר כתמונה במחברת ===== */
function sketchDialog() {
  if (!openId) return;
  restoreSelection(); const keep = savedRange && savedRange.cloneRange();
  dialog(d => {
    d.classList.add('sketch-dlg');
    d.innerHTML = `<h3>שרבוט</h3>
      <div class="sk-tools">
        <div class="sk-group" data-g="color">${['#1D1D1F', '#E5484D', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6'].map((c, i) => `<button type="button" class="sk-c${i ? '' : ' on'}" data-c="${c}" style="--c:${c}" aria-label="צבע"></button>`).join('')}</div>
        <div class="sk-group" data-g="size">${[2, 4, 8, 14].map((w, i) => `<button type="button" class="sk-w${i === 1 ? ' on' : ''}" data-w="${w}" aria-label="עובי ${w}"><i style="width:${w + 2}px;height:${w + 2}px"></i></button>`).join('')}</div>
        <div class="sk-group"><button type="button" class="sk-tool" data-t="eraser" title="מחק">🧽 מחק</button><button type="button" class="sk-tool" data-t="undo" title="ביטול">↶</button><button type="button" class="sk-tool" data-t="clear" title="ניקוי">🗑</button></div>
      </div>
      <div class="sk-wrap"><canvas id="skCv" width="1200" height="720"></canvas></div>`;
    const cv = d.querySelector('#skCv'), ctx = cv.getContext('2d');
    const bg = () => { ctx.save(); ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.restore(); };
    bg();
    let color = '#1D1D1F', width = 4, eraser = false, drawing = null, empty = true; const hist = [];
    const pt = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
    cv.addEventListener('pointerdown', e => {
      e.preventDefault(); cv.setPointerCapture(e.pointerId);
      hist.push(ctx.getImageData(0, 0, cv.width, cv.height)); if (hist.length > 30) hist.shift();
      const [x, y] = pt(e); drawing = { x, y, id: e.pointerId };
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = eraser ? '#fff' : color; ctx.lineWidth = (eraser ? width * 4 : width) * cv.width / 800;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + .01, y); ctx.stroke(); empty = false;
    });
    cv.addEventListener('pointermove', e => {
      if (!drawing || e.pointerId !== drawing.id) return;
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of evs) { const [x, y] = pt(ev); ctx.beginPath(); ctx.moveTo(drawing.x, drawing.y); ctx.lineTo(x, y); ctx.stroke(); drawing.x = x; drawing.y = y; }
    });
    const up = () => { drawing = null; }; cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    d.querySelector('.sk-tools').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.c) { color = b.dataset.c; eraser = false; d.querySelectorAll('.sk-c').forEach(x => x.classList.toggle('on', x === b)); d.querySelector('[data-t=eraser]').classList.remove('on'); }
      if (b.dataset.w) { width = +b.dataset.w; d.querySelectorAll('.sk-w').forEach(x => x.classList.toggle('on', x === b)); }
      if (b.dataset.t === 'eraser') { eraser = !eraser; b.classList.toggle('on', eraser); }
      if (b.dataset.t === 'undo' && hist.length) ctx.putImageData(hist.pop(), 0, 0);
      if (b.dataset.t === 'clear') { hist.push(ctx.getImageData(0, 0, cv.width, cv.height)); bg(); }
    });
    const row = document.createElement('div'); row.className = 'row';
    const ok = document.createElement('button'); ok.className = 'btn btn-primary'; ok.textContent = 'הוספה למחברת';
    const no = document.createElement('button'); no.className = 'btn btn-ghost'; no.textContent = 'ביטול'; no.onclick = closeDialog;
    ok.onclick = async () => {
      if (empty) { toast('קודם מציירים משהו'); return; }
      ok.disabled = true; ok.textContent = 'שומר...';
      // חותכים את השוליים הלבנים כדי שהשרבוט לא יתפוס מקום מיותר
      const W = cv.width, H = cv.height, px = ctx.getImageData(0, 0, W, H).data; let x0 = W, y0 = H, x1 = -1, y1 = -1;
      for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) { const i = (y * W + x) * 4; if (px[i] < 245 || px[i + 1] < 245 || px[i + 2] < 245) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
      if (x1 < 0) { ok.disabled = false; ok.textContent = 'הוספה למחברת'; toast('קודם מציירים משהו'); return; }
      const pad = 24; x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W, x1 + pad); y1 = Math.min(H, y1 + pad);
      const out = document.createElement('canvas'); out.width = x1 - x0; out.height = y1 - y0;
      out.getContext('2d').drawImage(cv, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
      let data = out.toDataURL('image/png'); if (data.length > 850000) data = out.toDataURL('image/jpeg', 0.85);
      try {
        const ref = doc(collection(db, 'users', me.uid, 'images'));
        await setDoc(ref, { data, createdAt: Date.now() }); imgCache.set(ref.id, data);
        closeDialog();
        if (keep) { const sl = getSelection(); sl.removeAllRanges(); sl.addRange(keep); savedRange = keep; }
        const p = document.createElement('p'); const img = document.createElement('img'); img.setAttribute('data-img', ref.id); img.src = data; p.appendChild(img);
        insertBlockAtCaret(p);
        if (!p.nextElementSibling) { const after = document.createElement('p'); after.appendChild(document.createElement('br')); p.after(after); }
        markDirty(); toast('השרבוט נוסף ✓');
      } catch (e) { console.error(e); ok.disabled = false; ok.textContent = 'הוספה למחברת'; toast('לא הצלחתי לשמור את השרבוט'); }
    };
    row.append(ok, no); d.appendChild(row);
  });
}
$('sketchBtn').addEventListener('click', sketchDialog);

$('statsCard').addEventListener('click', e => { if (e.target.closest('[data-go=cal]')) showTab('cal'); });

/* ===== הוספה מהירה: כותבים כמו שמדברים ("ש״ב במתמטיקה עמ' 45 למחר") ===== */
const WD = { 'ראשון': 0, 'שני': 1, 'שלישי': 2, 'רביעי': 3, 'חמישי': 4, 'שישי': 5, 'שבת': 6 };
const WD_L = { 'א': 0, 'ב': 1, 'ג': 2, 'ד': 3, 'ה': 4, 'ו': 5 };
function dayLabel(k) {
  const d = fromKey(k), n = daysUntil(k);
  if (n === 0) return 'היום'; if (n === 1) return 'מחר'; if (n === 2) return 'מחרתיים';
  return `יום ${HE_DAYS[d.getDay()]}, ${d.getDate()} ב${HE_MONTHS[d.getMonth()]}`;
}
function parseQuick(text) {
  let t = ' ' + text.replace(/\s+/g, ' ').trim() + ' ';
  const now = new Date(); now.setHours(12, 0, 0, 0);
  let date = null, time = '', type = 'hw', typeFound = false;
  const cut = re => { const m = t.match(re); if (m) t = t.replace(re, ' '); return m; };
  const add = n => { const d = new Date(now); d.setDate(d.getDate() + n); return d; };
  const nextWd = (w, nextWeek) => { const d = new Date(now); let diff = (w - d.getDay() + 7) % 7; if (diff === 0) diff = 7; if (nextWeek && diff < 7) diff += 7; d.setDate(d.getDate() + diff); return d; };
  const P = '(?:^|\\s)(?:עד |ל|ב|ל-|ב-|עד ה|עד ל)?';   // מילות יחס לפני התאריך
  let m;
  // שעה
  if ((m = cut(/\s(?:ב?שעה\s*)?(\d{1,2}):(\d{2})(?=\s)/))) time = `${String(Math.min(23, +m[1])).padStart(2, '0')}:${m[2]}`;
  else if ((m = cut(/\sב?שעה\s*(\d{1,2})(?=\s)/))) time = `${String(Math.min(23, +m[1])).padStart(2, '0')}:00`;
  // תאריך
  if ((m = cut(/(?:^|\s)(?:עד |ל|ב|ל-|ב-)?(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?=\s)/))) {
    let y = m[3] ? +m[3] : now.getFullYear(); if (y < 100) y += 2000;
    const d = new Date(y, +m[2] - 1, +m[1], 12); if (!m[3] && d < add(-1)) d.setFullYear(y + 1); date = d;
  }
  else if ((m = cut(new RegExp(P + 'מחרתיים(?=\\s)')))) date = add(2);
  else if ((m = cut(new RegExp(P + 'מחר(?=\\s)')))) date = add(1);
  else if ((m = cut(new RegExp(P + 'היום(?=\\s)')))) date = add(0);
  else if ((m = cut(/(?:^|\s)(?:עוד|בעוד)\s+(\d{1,2}|יומיים|שבוע|שבועיים)\s*(?:ימים)?(?=\s)/))) date = add({ 'יומיים': 2, 'שבוע': 7, 'שבועיים': 14 }[m[1]] ?? +m[1]);
  else if ((m = cut(new RegExp(P + '(?:יום\\s+)?(ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)(\\s+(?:ה)?(?:בא|הבא))?(?=\\s)')))) date = nextWd(WD[m[1]], false);
  else if ((m = cut(new RegExp(P + 'יום\\s+([אבגדהו])[\'׳]?(\\s+(?:ה)?(?:בא|הבא))?(?=\\s)')))) date = nextWd(WD_L[m[1]], false);
  else if ((m = cut(new RegExp(P + '(?:ה)?שבוע (?:ה)?בא(?=\\s)')))) date = add(7);
  // סוג
  if (/מבחן|בוחן|בחינה|בגרות|מבדק|בחן/.test(t)) { type = 'test'; typeFound = true; }
  else if (/ש״ב|ש"ב|שיעורי[- ]?בית|תרגיל|להגיש|הגשה|עבודה|לקרוא|לפתור|לסיים|דף עבודה|עמ['׳]?\s*\d|עמוד/.test(t)) { type = 'hw'; typeFound = true; }
  else if (/טיול|יום הולדת|יומולדת|מסיבה|הצגה|אסיפה|חוג|אימון|משחק|טקס|כנס|פגישה/.test(t)) { type = 'event'; typeFound = true; }
  const title = t.replace(/\s+/g, ' ').replace(/^[\s,:\-–]+|[\s,:\-–]+$/g, '').trim() || text.trim();
  let dateFound = !!date, subj = null;
  if (!date) { const nl = nextLesson(t); if (nl) { date = nl.date; subj = nl.subj; dateFound = true; } }
  if (!date) date = add(1);
  const k = key(date);
  return { title, type, typeFound, date: k, dateFound, dateLabel: dayLabel(k) + (subj ? ` (השיעור הבא ב${subj})` : ''), time, subj };
}
function quickPreview() {
  const lines = $('qaInput').value.split('\n').map(x => x.trim()).filter(Boolean);
  const pv = $('qaPreview'); pv.innerHTML = '';
  lines.slice(0, 12).forEach(l => {
    const q = parseQuick(l);
    const r = document.createElement('div'); r.className = 'qa-item';
    r.innerHTML = `<i class="dot t-${q.type}"></i><span class="tt"></span><span class="meta"></span>`;
    r.querySelector('.tt').textContent = q.title;
    r.querySelector('.meta').textContent = `${TYPE_NAME[q.type]} · ${q.dateLabel}${q.time ? ' · ' + q.time : ''}`;
    pv.appendChild(r);
  });
  $('qaGo').textContent = lines.length > 1 ? `הוספת ${lines.length} ליומן` : 'הוספה ליומן';
  $('qaGo').disabled = !lines.length;
  $('quickAdd').classList.toggle('has', lines.length > 0);
}
async function quickAdd() {
  const lines = $('qaInput').value.split('\n').map(x => x.trim()).filter(Boolean);
  if (!lines.length) { if (qaFiles.length) { toast('תכתוב מה זה, למשל: ש״ב במתמטיקה למחר'); $('qaInput').focus(); } return; }
  if (qaFiles.some(f => !f.up)) { toast('רגע, הקובץ עוד עולה'); return; }
  $('qaGo').disabled = true;
  try {
    const fl = qaFiles.map(f => f.up);
    for (const [i, l] of lines.slice(0, 30).entries()) { const q = parseQuick(l); await addDoc(evCol(), { title: q.title, type: q.type, time: q.time || '', date: q.date, done: false, createdAt: Date.now(), ...(i === 0 && fl.length ? { files: fl } : {}) }); }
    qaFiles = []; paintQaFiles(); $('qaInput').placeholder = 'מה יש לך? למשל: ש״ב במתמטיקה עמ׳ 45 למחר';
    const one = parseQuick(lines[0]);
    toast(lines.length > 1 ? `נוספו ${lines.length} דברים ליומן ✓` : `נוסף ליומן: ${one.dateLabel} ✓`);
    $('qaInput').value = ''; quickPreview(); $('qaInput').style.height = '';
  } catch (e) { console.error(e); toast('לא הצלחתי להוסיף'); }
  $('qaGo').disabled = false;
}
$('qaInput').addEventListener('input', () => { const i = $('qaInput'); i.style.height = ''; i.style.height = Math.min(220, i.scrollHeight) + 'px'; quickPreview(); });
$('qaInput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !$('qaInput').value.includes('\n')) { e.preventDefault(); quickAdd(); } });
$('qaGo').onclick = quickAdd;
quickPreview();

/* ===== קבצים מצורפים (PDF, Word, Excel...) — נשמרים ב-Firestore בחתיכות ===== */
const FILE_MAX = 15 * 1024 * 1024, CHUNK = 700000;
const fileBlobs = new Map();
const fmtSize = b => b < 1024 ? b + ' B' : b < 1048576 ? Math.round(b / 1024) + ' KB' : (b / 1048576).toFixed(1) + ' MB';
const fileIcon = n => { const e = (n.split('.').pop() || '').toLowerCase(); return e === 'pdf' ? '📕' : /^(docx?|odt|rtf)$/.test(e) ? '📘' : /^(xlsx?|csv|ods)$/.test(e) ? '📗' : /^(pptx?|odp|key)$/.test(e) ? '📙' : /^(png|jpe?g|gif|webp|heic)$/.test(e) ? '🖼️' : /^(mp3|m4a|wav|ogg)$/.test(e) ? '🎧' : /^(mp4|mov|webm)$/.test(e) ? '🎬' : /^(zip|rar|7z)$/.test(e) ? '🗜️' : '📄'; };
async function uploadFile(f, onProgress) {
  if (f.size > FILE_MAX) throw Object.assign(new Error('big'), { code: 'too-big' });
  const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(f); });
  const ref = doc(collection(db, 'users', me.uid, 'files')); const n = Math.max(1, Math.ceil(b64.length / CHUNK));
  for (let i = 0; i < n; i++) { await setDoc(chunkDoc(ref.id, i), { d: b64.slice(i * CHUNK, (i + 1) * CHUNK) }); if (onProgress) onProgress(Math.round((i + 1) / n * 100)); }
  const meta = { name: f.name.slice(0, 120), type: f.type || '', size: f.size };
  await setDoc(ref, { ...meta, chunks: n, createdAt: Date.now() });
  return { id: ref.id, name: meta.name, size: meta.size };
}
const fileChipHtml = (fl, removable) => `<div class="file-chip" data-file="${fl.id}" data-name="${String(fl.name).replace(/[<>"&]/g, '')}" data-size="${fl.size || 0}"><span class="fi">${fileIcon(fl.name)}</span><span class="fn"><b>${String(fl.name).replace(/[<>&]/g, '')}</b><small>${fl.size ? fmtSize(fl.size) : ''}</small></span><button type="button" class="fo" data-fa="open">פתיחה</button><button type="button" class="fo" data-fa="dl" title="הורדה">⬇</button>${removable ? '<button type="button" class="fx" data-fa="rm" title="הסרה">✕</button>' : ''}</div>`;
const fileDoc = (id, uid) => doc(db, 'users', uid || me.uid, 'files', id);
const chunkDoc = (id, i, uid) => doc(db, 'users', uid || me.uid, 'files', id, 'chunks', String(i));

function renderFiles(root, uid, readOnly) {
  root.querySelectorAll('div[data-file]').forEach(el => {
    const name = el.getAttribute('data-name') || 'קובץ', size = +el.getAttribute('data-size') || 0;
    el.contentEditable = 'false'; el.className = 'file-chip';
    el.innerHTML = `<span class="fi">${fileIcon(name)}</span><span class="fn"><b></b><small>${size ? fmtSize(size) : ''}</small></span><button type="button" class="fo" data-fa="open">פתיחה</button><button type="button" class="fo" data-fa="dl" title="הורדה">⬇</button>${readOnly ? '' : '<button type="button" class="fx" data-fa="rm" title="הסרה מהמחברת">✕</button>'}`;
    el.querySelector('b').textContent = name;
    el.dataset.uid = uid || '';
  });
}
async function getFileBlob(id, uid) {
  const k = (uid || me.uid) + '/' + id; if (fileBlobs.has(k)) return fileBlobs.get(k);
  const meta = await getDoc(fileDoc(id, uid)); if (!meta.exists()) throw new Error('missing');
  const m = meta.data(); const parts = [];
  for (let i = 0; i < m.chunks; i++) { const c = await getDoc(chunkDoc(id, i, uid)); if (!c.exists()) throw new Error('chunk'); parts.push(c.data().d); }
  const bin = atob(parts.join('')); const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const blob = new Blob([arr], { type: m.type || 'application/octet-stream' }); fileBlobs.set(k, { blob, name: m.name }); return { blob, name: m.name };
}
document.addEventListener('click', async e => {
  const b = e.target.closest('.file-chip [data-fa]'); if (!b) return;
  e.preventDefault(); e.stopPropagation();
  const chip = b.closest('.file-chip'), id = chip.getAttribute('data-file'), uid = chip.dataset.uid || undefined, act = b.dataset.fa;
  if (act === 'rm') { const inEv = chip.closest('.ev-files'); chip.remove(); if (!inEv) markDirty(); return; }
  // חלון חדש נפתח מיד (אחרת הדפדפן חוסם), והקובץ נטען לתוכו
  const canView = /\.(pdf|png|jpe?g|gif|webp|txt|mp3|mp4)$/i.test(chip.getAttribute('data-name') || '');
  const win = act === 'open' && canView ? window.open('', '_blank') : null;
  const old = b.textContent; b.textContent = '...'; b.disabled = true;
  try {
    const { blob, name } = await getFileBlob(id, uid);
    const url = URL.createObjectURL(blob);
    if (win) win.location.href = url;
    else { const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (err) { console.error(err); if (win) win.close(); toast('לא הצלחתי לפתוח את הקובץ'); }
  b.textContent = old; b.disabled = false;
});
async function addFiles(list) {
  if (!openId) return;
  restoreSelection();
  for (const f of list) {
    if (/^image\//.test(f.type) && !/svg/.test(f.type)) { await addImages([f]); continue; }     // תמונה רגילה נכנסת כתמונה
    if (f.size > FILE_MAX) { toast(`"${f.name}" גדול מדי (עד ${FILE_MAX / 1048576}MB)`); continue; }
    const holder = document.createElement('div'); holder.className = 'file-chip uploading'; holder.contentEditable = 'false';
    holder.innerHTML = `<span class="fi">${fileIcon(f.name)}</span><span class="fn"><b></b><small>מעלה... 0%</small></span>`;
    holder.querySelector('b').textContent = f.name;
    insertBlockAtCaret(holder);
    try {
      const up = await uploadFile(f, pc => { holder.querySelector('small').textContent = `מעלה... ${pc}%`; });
      const ref = { id: up.id };
      const el = document.createElement('div'); el.setAttribute('data-file', ref.id); el.setAttribute('data-name', f.name.slice(0, 120)); el.setAttribute('data-size', String(f.size));
      holder.replaceWith(el); renderFiles(el.parentElement || $('editor'));
      if (!el.nextElementSibling) { const after = document.createElement('p'); after.appendChild(document.createElement('br')); el.after(after); }
      markDirty(); toast('הקובץ נוסף ✓');
    } catch (err) { console.error(err); holder.remove(); toast(err && err.code === 'permission-denied' ? 'צריך לעדכן את כללי האבטחה ב-Firebase' : 'ההעלאה נכשלה'); }
  }
}
$('fileBtn').addEventListener('click', () => $('fileInput').click());
$('fileInput').addEventListener('change', e => { addFiles([...e.target.files]); e.target.value = ''; });
// גרירת קבצים: לכל מקום בדף. איפה שאתה נמצא קובע לאן הקובץ נכנס
let dragDepth = 0;
const hasFiles = e => [...((e.dataTransfer && e.dataTransfer.types) || [])].includes('Files');
function dropTarget() {
  if (document.querySelector('.ev-dlg')) return 'event';
  if (!$('notebook').classList.contains('hidden') && openId) return 'notebook';
  if (!$('home').classList.contains('hidden')) return 'quick';
  if (!$('calendar').classList.contains('hidden')) return 'quick';
  return null;
}
function dropHint(on) {
  let o = $('dropHint');
  if (!on) { if (o) o.remove(); return; }
  if (!o) { o = document.createElement('div'); o.id = 'dropHint'; o.className = 'drop-hint'; document.body.appendChild(o); }
  const t = dropTarget();
  o.innerHTML = `<div><b>📎 שחרר כדי לצרף</b><span>${t === 'notebook' ? 'הקובץ ייכנס למחברת, איפה שאתה משחרר' : t === 'event' ? 'הקובץ יצורף למשימה' : t === 'quick' ? 'הקובץ יצורף לשיעורי הבית שתוסיף ביומן' : 'פתח מחברת או את מסך הבית כדי לצרף קובץ'}</span></div>`;
  o.classList.toggle('no', !t);
}
document.addEventListener('dragenter', e => { if (!hasFiles(e) || !me) return; e.preventDefault(); dragDepth++; dropHint(true); });
document.addEventListener('dragover', e => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = dropTarget() ? 'copy' : 'none'; });
document.addEventListener('dragleave', e => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dropHint(false); });
document.addEventListener('drop', e => {
  if (!hasFiles(e)) return;
  e.preventDefault(); dragDepth = 0; dropHint(false);           // בלי זה הדפדפן פותח את הקובץ במקום האתר
  const fs = [...(e.dataTransfer.files || [])]; if (!fs.length || !me) return;
  const t = dropTarget();
  if (t === 'event') { const inp = document.querySelector('#edInput'); const dt = new DataTransfer(); fs.forEach(f => dt.items.add(f)); inp.files = dt.files; inp.onchange(); return; }
  if (t === 'notebook') {
    if ($('editor').contains(e.target) && document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(e.clientX, e.clientY); if (r && $('editor').contains(r.startContainer)) { const s2 = getSelection(); s2.removeAllRanges(); s2.addRange(r); savedRange = r.cloneRange(); } }
    addFiles(fs); return;
  }
  if (t === 'quick') {
    if ($('home').classList.contains('hidden')) showTab('home');
    const dt = new DataTransfer(); fs.forEach(f => dt.items.add(f)); $('qaFileInput').files = dt.files; $('qaFileInput').onchange();
    return;
  }
  toast('פתח מחברת או את מסך הבית כדי לצרף קובץ');
});

/* ===== פרטי משימה ביומן: הערה ("אילו שאלות") וקבצים ===== */
function eventDialog(id) {
  const e = events.find(x => x.id === id); if (!e) return;
  dialog(d => {
    d.classList.add('ev-dlg');
    d.innerHTML = `<h3>פרטי משימה</h3>
      <label class="fl">מה</label><input id="edTitle">
      <div class="ed-row">
        <div><label class="fl">סוג</label><select id="edType">${Object.entries(TYPE_NAME).map(([k, v]) => `<option value="${k}"${k === (e.type || 'other') ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
        <div><label class="fl">תאריך</label><input id="edDate" type="date" value="${e.date}"></div>
        <div><label class="fl">שעה</label><input id="edTime" type="time" value="${e.time || ''}"></div>
      </div>
      <label class="fl">הערות</label><textarea id="edNote" rows="3" placeholder="למשל: שאלות 1–5 ו־8, עמוד 45. לא לשכוח להראות דרך."></textarea>
      <label class="fl">קבצים</label>
      <div class="ev-files" id="edFiles">${(e.files || []).map(f => fileChipHtml(f, true)).join('')}</div>
      <button type="button" class="btn btn-ghost add-file" id="edAdd">📎 צירוף קובץ</button>
      <input type="file" id="edInput" multiple hidden>`;
    d.querySelector('#edTitle').value = e.title || '';
    d.querySelector('#edNote').value = e.note || '';
    d.querySelectorAll('.ev-files .file-chip').forEach(c => c.dataset.uid = '');
    const files = d.querySelector('#edFiles'), inp = d.querySelector('#edInput');
    d.querySelector('#edAdd').onclick = () => inp.click();
    inp.onchange = async () => {
      for (const f of [...inp.files]) {
        const ph = document.createElement('div'); ph.className = 'file-chip uploading'; ph.innerHTML = `<span class="fi">${fileIcon(f.name)}</span><span class="fn"><b></b><small>מעלה... 0%</small></span>`; ph.querySelector('b').textContent = f.name; files.appendChild(ph);
        try { const up = await uploadFile(f, pc => ph.querySelector('small').textContent = `מעלה... ${pc}%`); ph.outerHTML = fileChipHtml(up, true); }
        catch (err) { ph.remove(); toast(err.code === 'too-big' ? `"${f.name}" גדול מדי (עד 15MB)` : 'ההעלאה נכשלה'); }
      }
      inp.value = '';
    };
    const row = document.createElement('div'); row.className = 'row';
    const ok = document.createElement('button'); ok.className = 'btn btn-primary'; ok.textContent = 'שמירה';
    ok.onclick = async () => {
      if (files.querySelector('.uploading')) { toast('רגע, הקובץ עוד עולה'); return; }
      const fl = [...files.querySelectorAll('.file-chip[data-file]')].map(c => ({ id: c.getAttribute('data-file'), name: c.getAttribute('data-name'), size: +c.getAttribute('data-size') || 0 }));
      const dt = d.querySelector('#edDate').value || e.date;
      try {
        await updateDoc(evDoc(e.id), { title: d.querySelector('#edTitle').value.trim() || e.title, type: d.querySelector('#edType').value, date: dt, time: d.querySelector('#edTime').value || '', note: d.querySelector('#edNote').value.trim().slice(0, 2000), files: fl });
        closeDialog(); toast('נשמר ✓');
      } catch (err) { console.error(err); toast('לא נשמר'); }
    };
    const del = document.createElement('button'); del.className = 'btn btn-ghost danger-t'; del.textContent = 'מחיקה';
    del.onclick = () => { if (!del.dataset.sure) { del.dataset.sure = 1; del.textContent = 'בטוח? לחץ שוב'; return; } deleteDoc(evDoc(e.id)).then(closeDialog).catch(() => toast('המחיקה נכשלה')); };
    const no = document.createElement('button'); no.className = 'btn btn-ghost'; no.textContent = 'ביטול'; no.onclick = closeDialog;
    row.append(ok, no, del); d.appendChild(row);
  });
}

// 📎 גם בהוספה המהירה: הקבצים נצמדים למשימה שנוספת
let qaFiles = [];
function paintQaFiles() {
  const box = $('qaFiles'); box.innerHTML = qaFiles.map((f, i) => `<span class="qa-file${f.up ? '' : ' up'}"><span>${fileIcon(f.name)}</span><span class="nm"></span>${f.up ? `<button type="button" data-i="${i}" title="הסרה">✕</button>` : `<small>${f.pc || 0}%</small>`}</span>`).join('');
  box.querySelectorAll('.nm').forEach((n, i) => n.textContent = qaFiles[i].name);
  $('quickAdd').classList.toggle('has', !!qaFiles.length || !!$('qaInput').value.trim());
}
$('qaFiles').addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (!b) return; qaFiles.splice(+b.dataset.i, 1); paintQaFiles(); });
$('qaFileBtn').onclick = () => $('qaFileInput').click();
$('qaFileInput').onchange = async () => {
  for (const f of [...$('qaFileInput').files]) {
    const it = { name: f.name, pc: 0 }; qaFiles.push(it); paintQaFiles();
    try { it.up = await uploadFile(f, pc => { it.pc = pc; paintQaFiles(); }); }
    catch (err) { qaFiles = qaFiles.filter(x => x !== it); toast(err.code === 'too-big' ? `"${f.name}" גדול מדי (עד 15MB)` : 'ההעלאה נכשלה'); }
    paintQaFiles();
  }
  $('qaFileInput').value = '';
  if (!$('qaInput').value.trim()) { $('qaInput').placeholder = 'מה זה? למשל: ש״ב במתמטיקה שאלות 1–5 למחר'; $('qaInput').focus(); }
};

/* ===== מערכת שעות: יודעים מתי השיעור הבא בכל מקצוע ===== */
const TT_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי'], TT_ROWS = 10;
let timetable = { days: {} }, unsubTT = null;
const ttDoc = () => doc(db, 'users', me.uid, 'meta', 'timetable');
function subscribeTimetable() {
  if (unsubTT) unsubTT();
  unsubTT = onSnapshot(ttDoc(), snap => { timetable = (snap.exists() && snap.data()) || { days: {} }; if (!timetable.days) timetable.days = {}; paintTTBtn(); if ($('qaInput')) quickPreview(); }, () => {});
}
const SUBJ_GROUPS = [['מתמטיקה', 'מתמ', 'חשבון', 'מתימטיקה', 'מתמטיקא'], ['תנך', 'מקרא', 'תורה'], ['אנגלית', 'אנג'], ['היסטוריה', 'הסטוריה', 'היס'], ['ספרות'], ['לשון', 'עברית'], ['מדעים', 'מדע', 'מדעי'], ['פיזיקה', 'פיסיקה'], ['כימיה'], ['ביולוגיה', 'ביו'], ['אזרחות'], ['גאוגרפיה', 'גיאוגרפיה', 'גאו', 'גיאו'], ['ערבית'], ['חינוך גופני', 'ספורט', 'חנג', 'התעמלות'], ['מחשבים', 'מדעי המחשב', 'תכנות'], ['אומנות', 'אמנות'], ['מוזיקה', 'מוסיקה'], ['צרפתית'], ['חינוך'], ['תושבע', 'תורה שבעל פה', 'גמרא', 'משנה'], ['מחשבת ישראל', 'מחשבת']];
const normS = x => String(x || '').replace(/["״'׳`]/g, '').replace(/\s+/g, ' ').trim();
const squash = x => normS(x).replace(/\s/g, '');
function ttSubjects() { const set = new Set(); Object.values(timetable.days || {}).forEach(a => (a || []).forEach(v => { if (normS(v)) set.add(normS(v)); })); return [...set]; }
function subjMatches(text, subj) {
  const T = ' ' + normS(text) + ' ', S = squash(subj);
  const aliases = new Set([S, normS(subj).split(' ')[0]]);
  SUBJ_GROUPS.forEach(g => { if (g.some(a => squash(a) === S || S.startsWith(squash(a)) && squash(a).length >= 3)) g.forEach(a => aliases.add(squash(a))); });
  const toks = T.split(' ').filter(Boolean).flatMap(w => { const v = [w]; let x = w; for (let i = 0; i < 2 && /^[בלהומש]/.test(x) && x.length > 3; i++) { x = x.slice(1); v.push(x); } return v; });
  const flat = squash(T);
  for (const a of aliases) {
    if (!a || a.length < 2) continue;
    if (a.length >= 5 && flat.includes(a)) return true;
    if (toks.some(t => t === a || (a.length >= 3 && t.startsWith(a)))) return true;
  }
  return false;
}
function nextLesson(text) {
  const subs = ttSubjects(); if (!subs.length) return null;
  const subj = subs.find(s => subjMatches(text, s)); if (!subj) return null;
  const d = new Date(); d.setHours(12, 0, 0, 0);
  for (let i = 1; i <= 14; i++) {
    d.setDate(d.getDate() + 1);
    const hit = (timetable.days[d.getDay()] || []).find(v => normS(v) === subj); if (hit) return { date: new Date(d), subj: String(hit).trim() };
  }
  return null;
}
function paintTTBtn() { const b = $('ttBtn'); if (b) b.classList.toggle('on', ttSubjects().length > 0); }

function timetableDialog() {
  dialog(d => {
    d.classList.add('tt-dlg');
    const has = ttSubjects().length > 0;
    d.innerHTML = `<h3>🗓 מערכת שעות</h3>
      <p class="muted-s">כשתכתוב "ש״ב במתמטיקה" בלי תאריך, האתר ישים את זה ליום של השיעור הבא במתמטיקה.</p>
      <div class="tt-actions"><button type="button" class="btn btn-ghost" id="ttPhoto">📷 העלאת תמונה של המערכת</button><span class="muted-s" id="ttStatus">${has ? '' : 'או להקליד את המקצועות בטבלה'}</span></div>
      <input type="file" id="ttFile" accept="image/*,application/pdf" hidden>
      <div class="tt-scroll"><table class="tt"><thead><tr><th></th>${TT_DAYS.map(x => `<th>${x}</th>`).join('')}</tr></thead><tbody>${Array.from({ length: TT_ROWS }, (_, r) => `<tr><th>${r + 1}</th>${TT_DAYS.map((_, c) => `<td><input data-d="${c}" data-r="${r}" aria-label="יום ${TT_DAYS[c]} שיעור ${r + 1}"></td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    const fill = days => d.querySelectorAll('.tt input').forEach(i => { i.value = ((days[i.dataset.d] || [])[i.dataset.r]) || ''; });
    fill(timetable.days || {});
    d.querySelector('#ttPhoto').onclick = () => d.querySelector('#ttFile').click();
    d.querySelector('#ttFile').onchange = async ev => {
      const f = ev.target.files[0]; if (!f) return; ev.target.value = '';
      const st = d.querySelector('#ttStatus'); st.textContent = '✨ קורא את המערכת מהתמונה... (10–20 שניות)'; d.querySelector('#ttPhoto').disabled = true;
      try {
        let data, mime = f.type || 'image/jpeg';
        if (/^image\//.test(mime)) { data = (await shrink(f)); mime = (data.match(/^data:([^;]+);/) || [])[1] || 'image/jpeg'; data = data.split(',')[1]; }
        else data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(f); });
        const prompt = `זו מערכת שעות של תלמיד בישראל. קרא אותה והחזר JSON בלבד, בלי שום טקסט נוסף, בפורמט:
{"days":{"0":["מקצוע שיעור 1","מקצוע שיעור 2"],"1":[...],"2":[...],"3":[...],"4":[...],"5":[...]}}
0=ראשון, 1=שני, 2=שלישי, 3=רביעי, 4=חמישי, 5=שישי. לפי סדר השיעורים מהראשון. שיעור ריק או הפסקה = "". רק שם המקצוע (בלי שם המורה, החדר או השעה). אם אותו מקצוע מופיע כמה פעמים, כתוב אותו באותו שם בדיוק.`;
        let txt = '', lastErr = null;
        for (const name of AI_MODELS) { try { const r = await aiModel(name).generateContent([prompt, { inlineData: { mimeType: mime, data } }]); txt = r.response.text(); if (txt) break; } catch (e) { lastErr = e; console.error(name, e); } }
        if (!txt) throw lastErr || new Error('empty');
        const j = JSON.parse((txt.match(/\{[\s\S]*\}/) || ['{}'])[0]);
        const days = {}; for (let i = 0; i < 6; i++) days[i] = (j.days && Array.isArray(j.days[i]) ? j.days[i] : (j.days && j.days[String(i)]) || []).slice(0, TT_ROWS).map(v => String(v || '').replace(/\s+/g, ' ').trim().slice(0, 40));
        fill(days); st.textContent = '✓ מילאתי לפי התמונה. תבדוק שהכל נכון ותלחץ "שמירה".';
      } catch (e) { console.error(e); st.textContent = 'לא הצלחתי לקרוא את התמונה. אפשר להקליד בטבלה.'; }
      d.querySelector('#ttPhoto').disabled = false;
    };
    const row = document.createElement('div'); row.className = 'row';
    const ok = document.createElement('button'); ok.className = 'btn btn-primary'; ok.textContent = 'שמירה';
    ok.onclick = async () => {
      const days = {}; for (let i = 0; i < 6; i++) days[i] = [];
      d.querySelectorAll('.tt input').forEach(i => { days[i.dataset.d][i.dataset.r] = i.value.replace(/\s+/g, ' ').trim().slice(0, 40); });
      for (let i = 0; i < 6; i++) { const a = days[i]; for (let r = 0; r < TT_ROWS; r++) if (a[r] === undefined) a[r] = ''; while (a.length && !a[a.length - 1]) a.pop(); }
      try { await setDoc(ttDoc(), { days, updatedAt: Date.now() }); timetable = { days }; paintTTBtn(); closeDialog(); toast('מערכת השעות נשמרה ✓'); quickPreview(); }
      catch (e) { console.error(e); toast('לא נשמר'); }
    };
    const no = document.createElement('button'); no.className = 'btn btn-ghost'; no.textContent = 'ביטול'; no.onclick = closeDialog;
    row.append(ok, no); d.appendChild(row);
  });
}
$('ttBtn').onclick = timetableDialog;
if ($('ttBtn2')) $('ttBtn2').onclick = timetableDialog;
