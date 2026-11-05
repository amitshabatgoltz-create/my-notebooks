// אנימציות האתר (GSAP). אם GSAP לא נטען או שהמשתמש ביקש פחות תנועה, האתר חוזר לבד לאנימציות הרגילות שב-CSS.
(function () {
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const gsap = window.gsap;
  const on = () => !!gsap && !reduced();
  if (on()) document.documentElement.classList.add('gs');

  const ITEMS = '.hero-in>*, .card, .nb, .hw-card, .wk-ev';
  const MAX_STAGGERED = 24; // מעבר לזה הפריטים פשוט מופיעים, כדי שלא יהיו מאות אנימציות יחד
  const seen = new WeakSet();
  const CLEAR = 'opacity,visibility,transform';
  // הגנה: אם הדפדפן מאט אנימציות (טאב ברקע, חיסכון בסוללה), מסיימים בכוח כדי ששום דבר לא יישאר שקוף
  const guard = (a, ms = 1600) => { setTimeout(() => { if (a.parent && a.progress() < 1) a.progress(1); }, ms); return a; };

  function enter(list) {
    const fresh = list.filter(el => !seen.has(el));
    fresh.forEach(el => seen.add(el));
    const items = fresh.slice(0, MAX_STAGGERED);
    if (!items.length) return;
    items.forEach(el => el.classList.add('gs-run'));
    guard(gsap.fromTo(items, { opacity: 0, y: 18, scale: 0.985 }, {
      opacity: 1, y: 0, scale: 1, duration: 0.55, ease: 'power3.out', stagger: 0.05, clearProps: CLEAR,
      onComplete: () => items.forEach(el => el.classList.remove('gs-run'))
    }), 2500);
  }

  let watcher = null, watchEnd = 0;
  function stopWatching() { if (watcher) { watcher.disconnect(); watcher = null; } clearTimeout(watchEnd); }

  // הנתונים מגיעים מהענן אחרי שהמסך נפתח, אז בשנייה הראשונה מנפישים גם פריטים שנוספים בדרך
  function watch(view) {
    let batch = [], queued = false;
    watcher = new MutationObserver(records => {
      records.forEach(r => r.addedNodes.forEach(n => {
        if (n.nodeType !== 1) return;
        if (n.matches(ITEMS)) batch.push(n);
        n.querySelectorAll(ITEMS).forEach(el => batch.push(el));
      }));
      if (batch.length && !queued) {
        queued = true;
        queueMicrotask(() => { queued = false; const b = batch; batch = []; enter(b); });
      }
    });
    watcher.observe(view, { childList: true, subtree: true });
    watchEnd = setTimeout(stopWatching, 1000);
  }

  window.Motion = {
    get on() { return on(); },

    login() {
      if (!on()) return;
      const card = document.querySelector('.login-card');
      if (!card) return;
      const parts = [...card.children].filter(el => !el.classList.contains('app-icon'));
      guard(gsap.timeline({ defaults: { ease: 'power3.out', clearProps: CLEAR } })
        .fromTo(card, { opacity: 0, y: 26, scale: 0.97 }, { opacity: 1, y: 0, scale: 1, duration: 0.7 })
        .fromTo('.login-card .app-icon', { opacity: 0, scale: 0.4, rotation: -16 }, { opacity: 1, scale: 1, rotation: 0, duration: 0.7, ease: 'back.out(2)' }, 0.15)
        .fromTo(parts, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.45, stagger: 0.05 }, 0.25)
        .fromTo('.login-aside', { opacity: 0, x: -24 }, { opacity: 1, x: 0, duration: 0.8 }, 0.1), 2200);
    },

    view(el, name) {
      if (!on()) return;
      stopWatching();
      gsap.killTweensOf(el);
      guard(gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.25, ease: 'power1.out', clearProps: 'opacity' }), 900);
      if (name === 'notebook') return; // בתוך מחברת לא מזיזים תוכן בזמן שכותבים
      // מיד אחרי שהקוד שפתח את המסך סיים לצייר אותו
      queueMicrotask(() => {
        el.querySelectorAll(ITEMS).forEach(x => seen.delete(x));
        enter([...el.querySelectorAll(ITEMS)]);
      });
      watch(el);
    },

    dialog(overlay, box) {
      if (!on()) return;
      guard(gsap.fromTo(overlay, { opacity: 0 }, { opacity: 1, duration: 0.2, ease: 'power1.out', clearProps: 'opacity' }), 800);
      guard(gsap.fromTo(box, { opacity: 0, y: 24, scale: 0.96 }, { opacity: 1, y: 0, scale: 1, duration: 0.42, ease: 'back.out(1.5)', clearProps: 'opacity,transform' }), 900);
    },

    count(el, to) {
      if (!on() || to <= 0) { el.textContent = to; return; }
      const c = { v: 0 };
      el.textContent = 0;
      guard(gsap.to(c, { v: to, duration: 0.8, ease: 'power3.out', onUpdate: () => { el.textContent = Math.round(c.v); } }), 1400);
    },

    confetti(el) {
      if (!on()) return false;
      const r = el.getBoundingClientRect(), cols = ['#5E5CE6', '#FF5E8A', '#2EC4B6', '#F59E0B', '#10B981'];
      for (let k = 0; k < 26; k++) {
        const p = document.createElement('i'); p.className = 'confetti';
        p.style.cssText = `left:${r.left + r.width / 2}px;top:${r.top + r.height / 2}px;background:${cols[k % cols.length]}`;
        document.body.appendChild(p);
        const a = Math.random() * Math.PI * 2, d = 50 + Math.random() * 80;
        guard(gsap.timeline({ onComplete: () => p.remove() })
          .to(p, { x: Math.cos(a) * d, rotation: Math.random() * 720 - 360, duration: 1, ease: 'power1.out' }, 0)
          .to(p, { y: Math.sin(a) * d - 60, duration: 0.35, ease: 'power2.out' }, 0)
          .to(p, { y: '+=170', duration: 0.65, ease: 'power2.in' }, 0.35)
          .to(p, { opacity: 0, duration: 0.25 }, 0.75), 1500);
      }
      return true;
    }
  };
})();
