// עבודה בלי אינטרנט: קודם מנסים מהרשת (כדי לקבל עדכונים), ואם אין חיבור – מהעותק השמור
const CACHE = 'notebooks-1794474139';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'firebase-config.js', 'sample-notebook.js', 'manifest.webmanifest', 'icon-192.png', 'gsap.min.js', 'motion.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url);
  const mine = u.origin === location.origin, lib = u.hostname === 'www.gstatic.com' || u.hostname.endsWith('fonts.googleapis.com') || u.hostname.endsWith('fonts.gstatic.com');
  if (!mine && !lib) return;
  if (r.headers.has('range') || /\.(mp4|webm)$/i.test(u.pathname)) return;   // סרטונים: ישר מהרשת (בקשות חלקיות לא נשמרות במטמון)
  // את הקבצים של האתר עצמו תמיד בודקים מול השרת, כדי שעדכון יגיע מיד
  e.respondWith(fetch(mine ? new Request(r, { cache: 'no-cache' }) : r).then(res => {
    if (res.ok || res.type === 'opaque') { const cp = res.clone(); caches.open(CACHE).then(c => c.put(r, cp)); }
    return res;
  }).catch(() => caches.match(r, { ignoreSearch: mine }).then(m => m || (r.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});
self.addEventListener('notificationclick', e => { e.notification.close(); e.waitUntil(self.clients.matchAll({ type: 'window' }).then(cs => cs.length ? cs[0].focus() : self.clients.openWindow('./'))); });
