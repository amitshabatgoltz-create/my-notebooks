# אבטחה: מוסיף ל-index.html את ה-Content-Security-Policy – מאיפה מותר לטעון ולהריץ קוד.
# סקריפט שכתוב בתוך הדף מותר רק לפי טביעת אצבע (sha256). אם משנים סקריפט כזה ב-index.html – מריצים שוב:
#   python tools/csp.py
# (GitHub Pages לא נותן לשים כותרות, אז זה בתגית meta. במצב "רק דיווח" (Report-Only) אי אפשר להשתמש ב-meta – הדפדפן מתעלם)
import os, re, hashlib, base64
p = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'index.html')
s = open(p, encoding='utf-8', newline='').read()
s = re.sub(r'\n?<!-- אבטחה: רק קוד[^\n]*-->', '', s)
s = re.sub(r'\n?<meta http-equiv="Content-Security-Policy"[^>]*>', '', s)
hashes = []
for m in re.finditer(r'<script([^>]*)>(.*?)</script>', s, re.S):
    if 'src=' in m.group(1) or 'ld+json' in m.group(1): continue
    # GitHub שומר את הקובץ עם LF (גם אם במחשב יש CRLF) – הטביעה לפי מה שהדפדפן יקבל
    h = base64.b64encode(hashlib.sha256(m.group(2).replace('\r\n', '\n').encode('utf-8')).digest()).decode()
    hashes.append(f"'sha256-{h}'")
csp = "; ".join([
  "default-src 'self'",
  "script-src 'self' " + " ".join(hashes) + " https://www.gstatic.com/firebasejs/ https://www.gstatic.com/recaptcha/ https://www.google.com/recaptcha/ https://apis.google.com https://www.googletagmanager.com https://eu-assets.i.posthog.com https://*.firebasedatabase.app https://cdn.jsdelivr.net/npm/katex@0.16.11/ https://cdn.jsdelivr.net/npm/mammoth@1.8.0/ https://cdn.jsdelivr.net/npm/xlsx@0.18.5/",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net/npm/katex@0.16.11/",
  "font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net/npm/katex@0.16.11/",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob:",
  "connect-src 'self' data: blob: https://*.googleapis.com https://*.cloudfunctions.net https://*.run.app https://*.firebasedatabase.app wss://*.firebasedatabase.app https://eu.i.posthog.com https://eu-assets.i.posthog.com https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com https://www.google.com https://www.gstatic.com https://cdn.jsdelivr.net",
  "frame-src 'self' blob: https://my-notebooks-32ffd.firebaseapp.com https://accounts.google.com https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
])
meta = ('\n<!-- אבטחה: רק קוד מהמקומות האלה יכול לרוץ באתר. סקריפט בתוך הדף מזוהה לפי טביעת אצבע – אחרי שינוי באחד מהם: python tools/csp.py -->\n'
        f'<meta http-equiv="Content-Security-Policy" content="{csp}">')
i = s.index('<meta charset="utf-8">') + len('<meta charset="utf-8">')
s = s[:i] + meta + s[i:]
open(p, 'w', encoding='utf-8', newline='').write(s)
print(len(hashes), 'inline scripts hashed')
