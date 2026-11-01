import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  updateProfile, sendPasswordResetEmail, GoogleAuthProvider, signInWithPopup, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, addDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { SAMPLE_NOTEBOOK } from "./sample-notebook.js";

const $ = id => document.getElementById(id);
const COLORS = ['#2f5bd3','#d24b4b','#2e9e6a','#e08a1e','#7a4fd1','#d1478f','#1f8fa3','#4b5563'];

if (firebaseConfig.apiKey === "PASTE_HERE") {
  $('loginStatus').classList.add('err');
  $('loginStatus').textContent = 'צריך להדביק את הגדרות Firebase בקובץ firebase-config.js (ראה README).';
}

const fb = initializeApp(firebaseConfig);
const auth = getAuth(fb);
const db = getFirestore(fb);
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
  $('who').textContent = u.displayName || u.email || '';
}

onAuthStateChanged(auth, user => {
  if (unsub) { unsub(); unsub = null; }
  if (unsubEv) { unsubEv(); unsubEv = null; }
  me = user;
  if (user) {
    showUser(user);
    $('login').classList.add('hidden'); $('app').classList.remove('hidden');
    $('password').value = '';
    showTab('notes'); showLibrary(); subscribe(); subscribeEvents();
  } else {
    notebooks = []; events = []; openId = null;
    $('app').classList.add('hidden'); $('login').classList.remove('hidden');
  }
});

/* ================= נתונים ================= */
const nbCol = () => collection(db, 'users', me.uid, 'notebooks');
const nbDoc = id => doc(db, 'users', me.uid, 'notebooks', id);

function subscribe() {
  $('loading').classList.remove('hidden'); $('loading').textContent = 'טוען את המחברות...';
  $('sample').classList.add('hidden');
  unsub = onSnapshot(query(nbCol(), orderBy('updatedAt', 'desc')), snap => {
    $('loading').classList.add('hidden');
    notebooks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderGrid();
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
const ALLOWED = new Set(['P','H1','H2','H3','B','STRONG','I','EM','U','MARK','UL','OL','LI','BR','DIV','SPAN']);
function clean(html) {
  const d = new DOMParser().parseFromString('<div>' + (html || '') + '</div>', 'text/html');
  const walk = node => [...node.childNodes].forEach(ch => {
    if (ch.nodeType === 1) {
      if (!ALLOWED.has(ch.tagName)) {
        if (['SCRIPT','STYLE','IFRAME','OBJECT'].includes(ch.tagName)) { ch.remove(); return; }
        walk(ch); ch.replaceWith(...ch.childNodes); return;
      }
      [...ch.attributes].forEach(a => ch.removeAttribute(a.name));
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
function renderGrid() {
  const g = $('grid'); g.innerHTML = '';
  const add = document.createElement('button'); add.className = 'nb new';
  add.innerHTML = '<span style="font-size:40px;line-height:1">+</span><span>מחברת חדשה</span>';
  add.onclick = newNotebook; g.appendChild(add);
  notebooks.forEach(n => {
    const b = document.createElement('button'); b.className = 'nb'; b.style.background = n.color || COLORS[0];
    const l = document.createElement('div'); l.className = 'label'; l.textContent = n.title || 'מחברת ללא שם';
    const m = document.createElement('div'); m.className = 'meta'; m.textContent = n.updatedAt ? 'עודכן ' + fmtDate(n.updatedAt) : '';
    b.append(l, m); b.onclick = () => openNotebook(n.id); g.appendChild(b);
  });
  $('count').textContent = notebooks.length === 1 ? 'מחברת אחת' : notebooks.length ? `${notebooks.length} מחברות` : '';
}
function showLibrary() {
  openId = null;
  $('notebook').classList.add('hidden'); $('library').classList.remove('hidden');
  renderGrid(); window.scrollTo(0, 0);
}
function openNotebook(id) {
  const n = notebooks.find(x => x.id === id); if (!n) return;
  openId = id; dirty = false;
  $('title').value = n.title || '';
  $('editor').innerHTML = clean(n.html || '');
  $('save').textContent = 'נשמר';
  $('library').classList.add('hidden'); $('notebook').classList.remove('hidden');
  window.scrollTo(0, 0);
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
    d.innerHTML = '<h3>למחוק את המחברת?</h3>';
    const p = document.createElement('p'); p.textContent = `"${n.title}" תימחק עם כל מה שכתוב בה.`;
    const row = document.createElement('div'); row.className = 'row';
    const ok = document.createElement('button'); ok.className = 'btn btn-danger'; ok.textContent = 'מחיקה';
    const cancel = document.createElement('button'); cancel.className = 'btn btn-ghost'; cancel.textContent = 'ביטול'; cancel.onclick = closeDialog;
    ok.onclick = async () => {
      ok.disabled = true; clearTimeout(saveTimer); dirty = false;
      try { await deleteDoc(nbDoc(n.id)); closeDialog(); showLibrary(); toast('המחברת נמחקה'); }
      catch (e) { ok.disabled = false; toast('המחיקה נכשלה'); }
    };
    row.append(ok, cancel); d.append(p, row);
  });
};

/* ================= שמירה אוטומטית ================= */
function markDirty() { dirty = true; $('save').textContent = 'שומר...'; clearTimeout(saveTimer); saveTimer = setTimeout(flush, 1200); }
async function flush() {
  clearTimeout(saveTimer);
  if (!dirty || !openId || !me) return;
  if (saving) { saveTimer = setTimeout(flush, 400); return; }
  saving = true; dirty = false;
  const id = openId;
  try {
    await updateDoc(nbDoc(id), { title: $('title').value.trim() || 'מחברת ללא שם', html: clean($('editor').innerHTML), updatedAt: Date.now() });
    if (openId === id && !dirty) $('save').textContent = 'נשמר ✓';
  } catch (e) { dirty = true; $('save').textContent = 'לא נשמר — מנסה שוב'; saveTimer = setTimeout(flush, 3000); }
  finally { saving = false; }
}
$('editor').addEventListener('input', markDirty);
$('title').addEventListener('input', markDirty);
window.addEventListener('beforeunload', e => { if (dirty) { flush(); e.preventDefault(); e.returnValue = ''; } });

/* ================= סרגל עיצוב ================= */
// שומרים את המיקום של הסמן כדי שלחיצה על כפתור (גם בטלפון) לא תאבד אותו
let savedRange = null;
document.addEventListener('selectionchange', () => {
  const s = window.getSelection();
  if (s.rangeCount && $('editor').contains(s.anchorNode)) savedRange = s.getRangeAt(0).cloneRange();
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
  const b = e.target.closest('button'); if (!b) return;
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
  const html = e.clipboardData.getData('text/html');
  if (html) document.execCommand('insertHTML', false, clean(html));
  else document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
});


/* ================= ניווט ================= */
function showTab(t) {
  $('navNotes').classList.toggle('on', t === 'notes');
  $('navCal').classList.toggle('on', t === 'cal');
  if (t === 'cal') {
    flush();
    $('library').classList.add('hidden'); $('notebook').classList.add('hidden'); $('calendar').classList.remove('hidden');
    renderCalendar();
  } else {
    $('calendar').classList.add('hidden'); showLibrary();
  }
}
$('navNotes').onclick = () => showTab('notes');
$('navCal').onclick = () => showTab('cal');

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
  }, err => console.error(err));
}

function renderCalendar() {
  $('monthTitle').textContent = `${HE_MONTHS[viewMonth.getMonth()]} ${viewMonth.getFullYear()}`;
  const g = $('calGrid'); g.innerHTML = '';
  const start = new Date(viewMonth); start.setDate(1 - start.getDay());
  const byDay = {};
  events.forEach(e => (byDay[e.date] ||= []).push(e));
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
    list.slice(0, 3).forEach(e => {
      const ch = document.createElement('span'); ch.className = `chip t-${e.type || 'other'}` + (e.done ? ' done' : '');
      ch.textContent = e.title; c.appendChild(ch);
    });
    if (list.length > 3) { const m = document.createElement('span'); m.className = 'more'; m.textContent = `+${list.length - 3} נוספים`; c.appendChild(m); }
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
  sm.textContent = [TYPE_NAME[e.type] || 'אחר', e.time, showDate ? `יום ${HE_DAYS[d.getDay()]}, ${d.getDate()} ב${HE_MONTHS[d.getMonth()]}` : ''].filter(Boolean).join(' · ');
  t.append(sp, sm);
  if (showDate) { t.style.cursor = 'pointer'; t.onclick = () => { selDay = e.date; viewMonth = new Date(d.getFullYear(), d.getMonth(), 1); renderCalendar(); }; }
  const x = document.createElement('button'); x.className = 'x'; x.textContent = '✕'; x.title = 'מחיקה';
  x.onclick = () => deleteDoc(evDoc(e.id)).catch(() => toast('המחיקה נכשלה'));
  r.append(bar, cb, t, x); return r;
}

function renderDay() {
  const d = fromKey(selDay);
  $('dayTitle').textContent = (selDay === todayKey() ? 'היום · ' : '') + `יום ${HE_DAYS[d.getDay()]}, ${d.getDate()} ב${HE_MONTHS[d.getMonth()]}`;
  const box = $('dayList'); box.innerHTML = '';
  const list = events.filter(e => e.date === selDay);
  if (!list.length) { const p = document.createElement('div'); p.className = 'noev'; p.textContent = 'אין כלום ביום הזה.'; box.appendChild(p); }
  list.forEach(e => box.appendChild(evRow(e, false)));
}

function renderUpcoming() {
  const box = $('upcoming'); box.innerHTML = '';
  const tk = todayKey();
  const list = events.filter(e => e.date >= tk && !e.done).slice(0, 6);
  if (!list.length) { const p = document.createElement('div'); p.className = 'noev'; p.textContent = 'אין משימות פתוחות 🎉'; box.appendChild(p); }
  list.forEach(e => box.appendChild(evRow(e, true)));
}

$('evForm').addEventListener('submit', async e => {
  e.preventDefault();
  const title = $('evTitle').value.trim(); if (!title) return;
  try {
    await addDoc(evCol(), { title, type: $('evType').value, time: $('evTime').value || '', date: selDay, done: false, createdAt: Date.now() });
    $('evTitle').value = ''; $('evTime').value = '';
  } catch (err) { toast('לא הצלחתי להוסיף'); }
});
$('prevMonth').onclick = () => { viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1); renderCalendar(); };
$('nextMonth').onclick = () => { viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1); renderCalendar(); };
$('todayBtn').onclick = () => { const n = new Date(); viewMonth = new Date(n.getFullYear(), n.getMonth(), 1); selDay = todayKey(); renderCalendar(); };
