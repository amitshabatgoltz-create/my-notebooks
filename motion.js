// אנימציות האתר (GSAP). אם GSAP לא נטען או שהמשתמש ביקש פחות תנועה, האתר חוזר לבד לאנימציות הרגילות שב-CSS.
// שפת התנועה: מהיר ורגוע. עד חצי שנייה, ease של power3.out, ו-back.out רק לדברים קטנים שקופצים. בתוך מחברת פתוחה לא מזיזים כלום.
(function () {
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const gsap = window.gsap;
  const on = () => !!gsap && !reduced();
  if (on()) document.documentElement.classList.add('gs');

  const CARDS = '.hero-in>*, .card, .nb, .hw-card';
  const ITEMS = CARDS + ', .wk-day, .wk-ev, .bar i';
  const MAX_STAGGERED = 24; // מעבר לזה הפריטים פשוט מופיעים, כדי שלא יהיו מאות אנימציות יחד
  const seen = new WeakSet();
  const CLEAR = 'opacity,visibility,transform';
  // הגנה: אם הדפדפן מאט אנימציות (טאב ברקע, חיסכון בסוללה), מסיימים בכוח כדי ששום דבר לא יישאר שקוף
  const guard = (a, ms = 1600) => { setTimeout(() => { if (a.parent && a.progress() < 1) a.progress(1); }, ms); return a; };

  /* ===== כרטיסים: מה שעל המסך נכנס מיד, ומה שמתחת נחשף כשגוללים אליו ===== */
  function reveal(items) {
    if (!items.length) return;
    items.forEach(el => el.classList.add('gs-run'));
    guard(gsap.fromTo(items, { opacity: 0, y: 18, scale: 0.985 }, {
      opacity: 1, y: 0, scale: 1, duration: 0.55, ease: 'power3.out', stagger: 0.05, clearProps: CLEAR,
      onComplete: () => items.forEach(el => el.classList.remove('gs-run'))
    }), 2500);
  }
  const scrollIn = new IntersectionObserver(entries => {
    const hits = entries.filter(e => e.isIntersecting).map(e => e.target);
    hits.forEach(el => { scrollIn.unobserve(el); el.classList.remove('gs-wait'); });
    bars(hits.filter(el => el.matches('.bar i')));
    reveal(hits.filter(el => !el.matches('.bar i')));
  }); // בלי שוליים: פריט בתחתית העמוד חייב להיחשף גם כשאי אפשר לגלול אליו יותר

  /* ===== ציר השבוע: הימים נכנסים אחד אחרי השני, והמשימות קופצות לתוכם ===== */
  function week(days, evs) {
    if (days.length) guard(gsap.fromTo(days, { opacity: 0, x: 14 }, { opacity: 1, x: 0, duration: 0.45, ease: 'power3.out', stagger: 0.045, clearProps: CLEAR }), 1800);
    // from ולא fromTo: משימה שסומנה כבוצעה נשארת חצי שקופה בסוף
    if (evs.length) guard(gsap.from(evs.slice(0, MAX_STAGGERED), { opacity: 0, scale: 0.82, duration: 0.4, ease: 'back.out(1.8)', stagger: 0.03, delay: 0.18, clearProps: CLEAR }), 2000);
    const today = days.find(d => d.classList.contains('today'))?.querySelector('.wk-n');
    if (today) guard(gsap.fromTo(today, { scale: 0.7 }, { scale: 1, duration: 0.5, ease: 'back.out(3)', delay: 0.15, clearProps: 'transform' }), 1400);
  }

  /* ===== גרף המילים: העמודות צומחות מלמטה ===== */
  function bars(items) {
    if (items.length) guard(gsap.fromTo(items, { scaleY: 0, transformOrigin: '50% 100%' }, { scaleY: 1, duration: 0.6, ease: 'power3.out', stagger: 0.05, delay: 0.15, clearProps: 'transform,transformOrigin' }), 1800);
  }

  function enter(list) {
    const fresh = list.filter(el => !seen.has(el));
    fresh.forEach(el => seen.add(el));
    if (!fresh.length) return;
    const of = sel => fresh.filter(el => el.matches(sel));
    week(of('.wk-day'), of('.wk-ev'));
    const now = [], later = [], bottom = innerHeight;
    of(CARDS + ', .bar i').forEach(el => (el.getBoundingClientRect().top < bottom ? now : later).push(el));
    now.forEach(el => { scrollIn.unobserve(el); el.classList.remove('gs-wait'); });
    later.forEach(el => { el.classList.add('gs-wait'); scrollIn.observe(el); });
    bars(now.filter(el => el.matches('.bar i')));
    reveal(now.filter(el => !el.matches('.bar i')).slice(0, MAX_STAGGERED));
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

  /* ===== ניווט: סימון אחד שמחליק ללשונית הפעילה (בצד במחשב, למטה בטלפון) ===== */
  const navs = [];
  function placePill(nav, animate) {
    const b = nav.querySelector('button.on'), pill = nav._pill;
    if (!b || !b.offsetWidth) { gsap.set(pill, { autoAlpha: 0 }); return; }
    const to = { x: b.offsetLeft, y: b.offsetTop };
    gsap.set(pill, { width: b.offsetWidth, height: b.offsetHeight });
    const first = !nav.classList.contains('has-pill');
    nav.classList.add('has-pill');
    if (animate && !first) {
      gsap.set(pill, { autoAlpha: 1 });
      guard(gsap.to(pill, { ...to, duration: 0.4, ease: 'power3.out', overwrite: true }), 900);
      const ic = b.querySelector('svg');
      if (ic) guard(gsap.fromTo(ic, { scale: 0.7 }, { scale: 1, duration: 0.45, ease: 'back.out(3)', clearProps: 'transform', overwrite: true }), 900);
    } else gsap.set(pill, { ...to, autoAlpha: 1, overwrite: true });
  }
  function initNavs() {
    document.querySelectorAll('.side-nav,.tabbar').forEach(nav => {
      const pill = document.createElement('i'); pill.className = 'nav-pill'; pill.setAttribute('aria-hidden', 'true');
      nav.prepend(pill); nav._pill = pill; navs.push(nav);
      // גם כשהאפליקציה נחשפת אחרי הכניסה, וכשמשנים גודל חלון
      new ResizeObserver(() => { if (on()) placePill(nav, false); }).observe(nav);
    });
  }

  /* ===== כרטיס מחברת נוטה לכיוון העכבר (רק במחשב) ===== */
  if (on() && matchMedia('(hover: hover) and (pointer: fine)').matches) {
    let cur = null, rx = null, ry = null;
    const release = () => {
      if (!cur) return;
      const el = cur; cur = null;
      gsap.to(el, { rotationX: 0, rotationY: 0, y: 0, duration: 0.45, ease: 'power3.out', overwrite: true, clearProps: 'transform', onComplete: () => el.classList.remove('gs-tilt') });
    };
    document.addEventListener('pointermove', e => {
      const hit = on() && e.target.closest ? e.target.closest('.nb') : null;
      const el = hit && !hit.classList.contains('gs-run') ? hit : null;
      if (el !== cur) {
        release();
        if (el) {
          cur = el; el.classList.add('gs-tilt');
          gsap.set(el, { transformPerspective: 700 });
          gsap.to(el, { y: -4, duration: 0.25, ease: 'power3.out', overwrite: true });
          rx = gsap.quickTo(el, 'rotationX', { duration: 0.35, ease: 'power3' });
          ry = gsap.quickTo(el, 'rotationY', { duration: 0.35, ease: 'power3' });
        }
      }
      if (!cur) return;
      const r = cur.getBoundingClientRect();
      rx(-((e.clientY - r.top) / r.height - 0.5) * 8);
      ry(((e.clientX - r.left) / r.width - 0.5) * 8);
    }, { passive: true });
    document.documentElement.addEventListener('pointerleave', release);
  }

  /* ===== לחיצה: הכפתור נכנס קצת וקופץ בחזרה (בעיקר מורגש בטלפון) ===== */
  if (on()) {
    const PRESS = '.btn,.side-new,.side-nb,.side-nav button,.tabbar button,.chat-send,.chat-attach';
    let pressed = null;
    const up = () => {
      if (!pressed) return;
      gsap.to(pressed, { scale: 1, duration: 0.4, ease: 'back.out(3)', clearProps: 'transform', overwrite: true });
      pressed = null;
    };
    document.addEventListener('pointerdown', e => {
      const el = e.target.closest ? e.target.closest(PRESS) : null;
      if (!el || el.disabled || !on()) return;
      pressed = el;
      gsap.to(el, { scale: 0.96, duration: 0.1, ease: 'power2.out', overwrite: true });
    }, { passive: true });
    addEventListener('pointerup', up, { passive: true });
    addEventListener('pointercancel', up, { passive: true });
  }

  let ghost = null, ghostAnim = null;
  function dropGhost() { if (ghostAnim) ghostAnim.kill(); if (ghost) ghost.remove(); ghost = ghostAnim = null; }

  window.Motion = {
    get on() { return on(); },

    login() {
      if (!on()) return;
      const card = document.querySelector('.login-card');
      if (!card) return;
      const parts = [...card.children].filter(el => !el.classList.contains('app-icon'));
      // הכותרת בצד נכתבת מילה אחרי מילה
      const h2 = document.querySelector('.login-aside h2');
      if (h2 && !h2.children.length) {
        const words = h2.textContent.trim().split(/\s+/);
        h2.textContent = '';
        words.forEach(w => {
          const s = document.createElement('span'); s.className = 'gs-word'; s.textContent = w;
          h2.append(s);
        });
      }
      guard(gsap.timeline({ defaults: { ease: 'power3.out', clearProps: CLEAR } })
        .fromTo(card, { opacity: 0, y: 26, scale: 0.97 }, { opacity: 1, y: 0, scale: 1, duration: 0.7 })
        .fromTo('.login-card .app-icon', { opacity: 0, scale: 0.4, rotation: -16 }, { opacity: 1, scale: 1, rotation: 0, duration: 0.7, ease: 'back.out(2)' }, 0.15)
        .fromTo(parts, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.45, stagger: 0.05 }, 0.25)
        .fromTo('.login-aside', { opacity: 0, x: -24 }, { opacity: 1, x: 0, duration: 0.8 }, 0.1)
        .fromTo('.gs-word', { opacity: 0, y: 22 }, { opacity: 1, y: 0, duration: 0.55, stagger: 0.07 }, 0.3)
        .fromTo('.la-week>div', { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.5, stagger: 0.07 }, 0.55)
        // השבוע מתמלא: החזרות נכנסות אחת אחת, והמבחן נוחת אחרון
        .fromTo('.la-week .plan', { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.4, ease: 'back.out(2.2)', stagger: 0.14 }, 1)
        .fromTo('.la-week .test', { opacity: 0, scale: 0.4, rotation: -8 }, { opacity: 1, scale: 1, rotation: 0, duration: 0.6, ease: 'back.out(3)' }, 1.5), 3200);
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

    // הסימון בתפריט מחליק ללשונית שנבחרה
    tab() {
      if (!on()) return;
      if (!navs.length) initNavs();
      navs.forEach(nav => placePill(nav, true));
    },

    dialog(overlay, box) {
      if (!on()) return;
      dropGhost();
      guard(gsap.fromTo(overlay, { opacity: 0 }, { opacity: 1, duration: 0.2, ease: 'power1.out', clearProps: 'opacity' }), 800);
      guard(gsap.fromTo(box, { opacity: 0, y: 24, scale: 0.96 }, { opacity: 1, y: 0, scale: 1, duration: 0.42, ease: 'back.out(1.5)', clearProps: 'opacity,transform' }), 900);
    },

    // סגירת חלון: הקוד ממשיך מיד כאילו החלון נסגר, ורק העתק שלו בלי מזהים נעלם לאט על המסך
    dialogOut(root) {
      const o = root.firstElementChild;
      if (!on() || !o) return;
      dropGhost();
      const box = o.querySelector('.dialog');
      const copy = o.cloneNode(true);
      copy.removeAttribute('id');
      copy.querySelectorAll('[id]').forEach(x => x.removeAttribute('id'));
      copy.setAttribute('aria-hidden', 'true');
      copy.style.pointerEvents = 'none';
      copy.classList.add('gs-ghost');
      document.body.appendChild(copy);
      const cb = copy.querySelector('.dialog');
      if (cb && box) cb.scrollTop = box.scrollTop;
      ghost = copy;
      ghostAnim = guard(gsap.timeline({ onComplete: dropGhost })
        .to(copy, { opacity: 0, duration: 0.2, ease: 'power1.in' }, 0)
        .to(cb, { y: 14, scale: 0.98, duration: 0.2, ease: 'power2.in' }, 0), 500);
    },

    toast(t) {
      if (!on()) return;
      guard(gsap.fromTo(t, { xPercent: -50, x: 0, y: 22, scale: 0.92, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: 0.42, ease: 'back.out(1.6)' }), 900);
    },
    toastOut(t) {
      if (!on()) { t.remove(); return; }
      guard(gsap.to(t, { y: 12, opacity: 0, duration: 0.2, ease: 'power2.in', overwrite: true, onComplete: () => t.remove() }), 500);
    },

    // החלפת חודש ביומן. dir=1 קדימה: בעברית קדימה זה שמאלה, אז החודש החדש נכנס משמאל
    month(el, dir) {
      if (!on()) return;
      guard(gsap.fromTo(el, { opacity: 0, x: dir * -22 }, { opacity: 1, x: 0, duration: 0.32, ease: 'power3.out', clearProps: CLEAR, overwrite: true }), 800);
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
