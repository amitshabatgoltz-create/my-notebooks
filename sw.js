// עבודה בלי אינטרנט: קודם מנסים מהרשת (כדי לקבל עדכונים), ואם אין חיבור – מהעותק השמור
const CACHE = 'notebooks-1795896607';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'firebase-config.js', 'sample-notebook.js', 'manifest.webmanifest', 'icon-192.png', 'gsap.min.js', 'motion.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url);
  const mine = u.origin === location.origin, lib = u.hostname === 'www.gstatic.com' || u.hostname.endsWith('fonts.googleapis.com') || u.hostname.endsWith('fonts.gstatic.com');
  if (!mine && !lib) return;
  if (r.headers.has('range') || /\.(mp4|webm)$/i.test(u.pathname)) return;   // סרטונים: ישר מהרשת (בקשות חלקיות לא נשמרות במטמון)
  const keep = (req, res) => { if (res.ok || res.type === 'opaque') { const cp = res.clone(); caches.open(CACHE).then(c => c.put(req, cp)); } return res; };
  // קבצים עם מספר גרסה (app.js?v=..., Firebase 13.1.0) לא משתנים אף פעם: ישר מהמטמון, בלי לשאול את השרת. גרסה חדשה = כתובת חדשה
  if ((mine && u.searchParams.has('v')) || (u.hostname === 'www.gstatic.com' && /^\/firebasejs\/\d/.test(u.pathname))) {
    e.respondWith(caches.match(r).then(m => m || fetch(r).then(res => keep(r, res))));
    return;
  }
  // הדף עצמו: קודם מהרשת (בשביל עדכונים), אבל אם הרשת איטית (טלפון, וויפי של בית ספר) – אחרי 2.5 שנ' מהעותק השמור
  if (r.mode === 'navigate') {
    const net = fetch(new Request(r, { cache: 'no-cache' })).then(res => keep(r, res));
    const saved = () => caches.match(r, { ignoreSearch: true }).then(m => m || caches.match('index.html'));
    e.respondWith(new Promise(done => {
      let over = false; const fin = x => { if (!over && x) { over = true; done(x); } };
      const t = setTimeout(() => saved().then(fin), 2500);
      net.then(res => { clearTimeout(t); fin(res); }).catch(() => saved().then(m => { over ? 0 : (over = true, done(m || Response.error())); }));
    }));
    return;
  }
  // את שאר הקבצים של האתר עצמו בודקים מול השרת, כדי שעדכון יגיע מיד
  e.respondWith(fetch(mine ? new Request(r, { cache: 'no-cache' }) : r).then(res => {
    if (res.ok || res.type === 'opaque') { const cp = res.clone(); caches.open(CACHE).then(c => c.put(r, cp)); }
    return res;
  }).catch(() => caches.match(r, { ignoreSearch: mine }).then(m => m || (r.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});
// תזכורות מהשרת (Push): הכותרת והטקסט מגיעים מ-pushDaily / pushTest
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'המחברות שלי', { body: d.body || '', icon: 'icon-192.png', badge: 'icon-192.png', tag: d.tag || 'reminder', lang: 'he', dir: 'rtl', data: { url: d.url || './' } }));
});
// לחיצה: אם האתר כבר פתוח – רק מביאים אותו קדימה (בלי לטעון מחדש באמצע כתיבה); אחרת פותחים
self.addEventListener('notificationclick', e => {
  e.notification.close(); const url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => { const c = cs.find(x => 'focus' in x); if (c) { c.postMessage({ t: 'push-open' }); return c.focus(); } return self.clients.openWindow(url); }));
});
