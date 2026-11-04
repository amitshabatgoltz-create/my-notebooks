# המחברות שלי – הוראות לעבודה על הפרויקט

אתר מחברות ויומן לתלמידים, בעברית (RTL). האתר החי: https://amitshabatgoltz-create.github.io/my-notebooks/

## איך לדבר עם המשתמש
- המשתמש הוא תלמיד, עמית. **תמיד לענות בעברית**, פשוט וקצר, בלי מונחים טכניים מיותרים.
- **לא לשאול לפני העלאה:** כל שינוי שמוכן עולה ישר לאתר החי (המשתמש ביקש "תעלה תמיד").
- אחרי כל שינוי: להסביר מה השתנה ואיך לראות את זה (בדרך כלל "תרענן פעמיים").

## מבנה
- אתר סטטי בלי שלב build: `index.html`, `style.css`, `app.js` (מודול ES אחד גדול, כ-4,000 שורות, מחולק לאזורים עם כותרות `/* ===== ... ===== */`).
- `firebase-config.js` – ההגדרות של Firebase (פרויקט `my-notebooks-32ffd`). `sample-notebook.js` – מחברת לדוגמה.
- `sw.js` – service worker: קודם רשת, ואם אין אינטרנט – מהמטמון. `manifest.webmanifest` + אייקונים – אפליקציה במסך הבית.
- `firestore.rules`, `database.rules.json` – הכללים מודבקים **ידנית** בקונסול של Firebase (אין deploy אוטומטי). אם משנים אותם – להגיד למשתמש להדביק.
- Firebase JS SDK 13.1.0 מ-gstatic: Auth, Firestore (מטמון מקומי), AI Logic (Gemini), App Check (reCAPTCHA Enterprise), Realtime Database (רק אם יש `databaseURL` בהגדרות – כרגע אין, אז עריכה משותפת עובדת דרך Firestore).

## איפה הנתונים (Firestore)
- `users/{uid}/notebooks`, `/events` (יומן: title, type test|hw|event|other, date YYYY-MM-DD, time, done, note, files, autoDate, planFor), `/images`, `/files/{id}/chunks/{n}`, `/cards/{nbId}` (כרטיסיות שינון), `/chats/{id}` (שיחות עם העוזר הלימודי: title, history, mem, createdAt, updatedAt).
- `users/{uid}/meta/`: `timetable` {days, start, times}, `usage` (מכסה יומית), `grades` {items: [{id, s, n, g, w, d}]}, `activity`.
- `shares/{id}` – מחברות משותפות (mode: view | copy | edit), עם `presence`.

## מכסה יומית ל-AI
מכסת Gemini של כל האתר יחד (Free tier, נבדק ב-AI Studio ב-4.11.2026): Flash 20 ביום ו-5 בדקה, Flash Lite 500 ביום ו-15 בדקה. בינתיים כל האתר על Lite. Flash שמור למנוי פרו עתידי: הבחירה ב-`aiModels()`, והמתג הוא `isPro()` (כרגע false). מנוי אמיתי דורש תשלום ובדיקה בשרת, כי בדיקה בדפדפן אפשר לעקוף. `gemini-2.5-flash` ו-`gemini-2.5-flash-lite` הוסרו.
- `DAILY = { ocr: 3, sum: 2, qa: 3, fc: 3, chat: 30, cf: 3, kit: 3 }` (תמונה לטקסט – לפי מספר תמונות, סיכום, עבודה מהמורה, כרטיסיות, הודעות לעוזר הלימודי, קבצים שמעלים לעוזר, שאלונים ודפי חזרה). המכסה נבדקת בדפדפן ונשמרת במסמך של המשתמש, אז אפשר לעקוף אותה. מתאפס בחצות.
- `UNLIMITED` – האימייל של המשתמש בלי הגבלה. לא להשתמש באימייל הזה לשום דבר אחר.
- ייבוא מערכת שעות / לוח מבחנים / ציונים – לא נספר במכסה.

## עוזר לימודי
חלון צ'אט אחד (`#chatPanel`) בשני מקומות: כרטיסייה במסך מלא (`chatView`, עוזר כללי), ובועה מעל מחברת (קורא את המחברת). `chatPlace(v)` מזיז אותו. פעולות: JSON בתחילת התשובה בלבד (`chatSplit`): `ADD_TO_CALENDAR` (התאריך מההודעה דרך `parseQuick`), `QUIZ` ו-`SHEET` (כרטיסים בצ'אט: `chatQuizEl`, `chatSheetEl`, נשמרים בתוך `history[].card`). ב-Firestore אין מערך בתוך מערך, ולכן שורות הטבלה הן `{c: [...]}`.

מסך הבית: התיבה `#haInput` שולחת לעוזר ועוברת לעמוד שלו (`homeAsk`). ההוספה המהירה הישנה (`#quickAdd`) מוסתרת, והקוד שלה נשאר כי אלמנטים שלה נטענים בפתיחה.

## כללים חשובים
1. **לפני כל העלאה – בדיקת תחביר כמודול:** `cp app.js /tmp/a.mjs && node --check /tmp/a.mjs`. (`node --check app.js` לבד לא תופס שגיאות – ככה פעם עלה באג ששבר את כל האתר.)
2. **בכל העלאה – להעלות מספר גרסה**, אחרת הדפדפן והטלפון ממשיכים להציג את הישנה:
   - ב-`index.html`: `app.js?v=...` ו-`style.css?v=...`
   - ב-`sw.js`: `const CACHE = 'notebooks-...'`
   ```bash
   v=$(date +%s); sed -i -E "s/app\.js\?v=[0-9]+/app.js?v=$v/; s/style\.css\?v=[0-9]+/style.css?v=$v/" index.html; sed -i -E "s/(const CACHE *= *['\"][^'\"]*-)[0-9]+/\1$v/" sw.js
   ```
3. העלאה = `git push` ל-main. GitHub Pages מתעדכן תוך כדקה. לפעמים GitHub מחזיר שגיאת 500 – פשוט לנסות שוב.
4. כל HTML שנכנס למחברת עובר דרך `clean()` – רשימה סגורה של תגיות ותכונות (`ALLOWED`). תכונה חדשה שצריכה להישמר (כמו `dir`, `data-a`) – להוסיף שם.
5. חלונות: `dialog(build)` / `closeDialog()`. הודעות: `toast(msg)`, `toastAction(msg, label, fn)`. הסבר בפעם הראשונה: `introOnce(key)` עם `INTROS` ו-`ILL` (איורי SVG).
6. AI: `aiText` (זרם HTML), `aiExtract` / `aiJson` (JSON), `notebookParts()` (טקסט ותמונות מהמחברת).
7. חלון עם `<input type=file>` מקבל אוטומטית גרירה והדבקה של קבצים (`dialogFileInput` / `feedInput`).
8. תשובות AI שנכנסות למחברת – בלי הערות מיותרות (ראה `qaForNotebook`).
9. לבדוק גם בטלפון (רוחב 390). יש מצב כהה: `html[data-theme="dark"]`.
