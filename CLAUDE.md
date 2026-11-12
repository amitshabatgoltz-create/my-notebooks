# המחברות שלי – הוראות לעבודה על הפרויקט

אתר מחברות ויומן לתלמידים, בעברית (RTL). האתר החי: https://amitshabatgoltz-create.github.io/my-notebooks/

## איך לדבר עם המשתמש
- המשתמש הוא תלמיד, עמית. **תמיד לענות בעברית**, פשוט וקצר, בלי מונחים טכניים מיותרים.
- **לא לשאול לפני העלאה:** כל שינוי שמוכן עולה ישר לאתר החי (המשתמש ביקש "תעלה תמיד").
- אחרי כל שינוי: להסביר מה השתנה ואיך לראות את זה (בדרך כלל "תרענן פעמיים").

## מבנה
- הדף הראשי `https://amitshabatgoltz-create.github.io/` הוא ריפו נפרד `amitshabatgoltz-create/amitshabatgoltz-create.github.io` (ענף main): דף כניסה עם הסמל והשם "המחברות שלי" – משם גוגל לוקח את ה-favicon ואת שם האתר בתוצאות. לא למחוק.
- גוגל (7.11.2026): האתר מאומת ב-Google Search Console דרך `google0dd89255096ae44f.html` – **לא למחוק את הקובץ**. `sitemap.xml` נשלח. ב-`index.html` יש title, description, canonical, Open Graph ו-JSON-LD.
- אתר סטטי בלי שלב build: `index.html`, `style.css`, `app.js` (מודול ES אחד גדול, כ-4,000 שורות, מחולק לאזורים עם כותרות `/* ===== ... ===== */`).
- `motion.js` + `gsap.min.js` – כל האנימציות, דרך `window.Motion` (`view`, `tab`, `dialog`, `dialogOut`, `toast`, `toastOut`, `month`, `count`, `confetti`). תמיד לקרוא עם `window.Motion?.`. אם GSAP לא נטען או שביקשו פחות תנועה, האתר חוזר ל-CSS. כרטיסים מתחת למסך מקבלים `.gs-wait` ונחשפים בגלילה. בתוך מחברת פתוחה לא מזיזים תוכן.
- `firebase-config.js` – ההגדרות של Firebase (פרויקט `my-notebooks-32ffd`). `sample-notebook.js` – מחברת לדוגמה.
- `sw.js` – service worker: קודם רשת, ואם אין אינטרנט – מהמטמון. `manifest.webmanifest` + אייקונים – אפליקציה במסך הבית.
- `firestore.rules`, `database.rules.json` – הכללים מודבקים **ידנית** בקונסול של Firebase (אין deploy אוטומטי). אם משנים אותם – להגיד למשתמש להדביק.
- Firebase JS SDK 13.1.0 מ-gstatic: Auth, Firestore (מטמון מקומי), AI Logic (Gemini), App Check (reCAPTCHA Enterprise), Realtime Database (europe-west1, `databaseURL` בהגדרות מ-9.11.2026): ערוץ מהיר לעריכה משותפת. `startLive` בודק קודם שהוא עובד (`probe`) ורק אז עובר אליו (`startRtdb`); אם נחסם – נשאר ב-Firestore (`firePresence`, `rtdbBad`).

## איפה הנתונים (Firestore)
- `users/{uid}/notebooks`, `/events` (יומן: title, type test|hw|event|other, date YYYY-MM-DD, time, done, note, files, autoDate, planFor), `/images`, `/files/{id}/chunks/{n}`, `/cards/{nbId}` (כרטיסיות שינון), `/chats/{id}` (שיחות עם העוזר הלימודי: title, history, mem, createdAt, updatedAt).
- `users/{uid}/meta/`: `timetable` {days, start, times}, `usage` (מכסה יומית), `grades` {items: [{id, s, n, g, t (סוג), d}], cats: {מקצוע: [{n, p}]} – אחוז לכל סוג; ממוצע לפי `subjAvg`}, `activity`.
- `stats/{uid}` – סטטיסטיקה לעמוד "ניהול האתר" (name, email, first, last, lastDay, nb, device, ai{סוג: מספר}, mins – דקות באתר, days{YYYY-MM-DD: {m, ai{סוג}}} – לפי יום, נשמרים 21 יום; `statsFlush` כל 30 שניות פעילות (שניות ב-days[יום].s, דקות שלמות ב-mins), `admToday` = כרטיס "היום באתר", לחיצה על שם משתמש – `admUserDialog`: 3 שבועות לפי יום). כל משתמש כותב רק את שלו (`statsPing`, `statsAi`), ורק בעל האתר קורא את כולם (לפי request.auth.token.email בכללים – זה צד-שרת, לא נחשף בדפדפן). Google Analytics פעיל דרך `track(name, params)`.
- פרסים קטנים בכל שלב (`big` = פרס גדול): 2 רקעים `stars/gold/color`, 4 גופן `fun` (נעולים דרך `REF_LOCKED_OPT`/`refOptLock` ב-`nbSettingsUI`), 5 +1 סיכום, 6 צבע לאתר (`SITE_ACCENTS`, localStorage `accent:<uid>`, `siteAccentApply`), 8 מסגרת לעיגול (`.avatar.framed`), 9 +1 כרטיסיות.
- תוכנית חברים (10.11.2026): מדרגות `REF_TIERS` – 1 חבר: צבעים מיוחדים (`SPECIAL_COLORS` ב-`nbColorDialog`), 3: +5 הודעות לעוזר, 7: 7 תמונות לטקסט, 10: תג שגריר (`.amb-tag`, `.avatar.amb`). `refApply` משנה את `DAILY`. חבר חדש מקבל ביום הראשון +1 תמונה ו-+1 סיכום (localStorage `refNew:<uid>`). `inviteDialog` = סולם מדרגות; `refVideo` = הסרטון בכניסה הראשונה עם כפתור "לעמוד החברים" בסוף (`refVid1:<uid>`, דרך `refGuideMaybe`); `refGuide` = הדרכה ב-3 שקפים מ"איך זה עובד"; `refCelebrate` כשעולים מדרגה. `INVITE_POP_HASH` – רק החלון שקופץ בכניסה.
- עמוד "חברים" (`friendsView`, טאב `fr` בתפריט הצד, באנר `#homeFriends` במסך הבית): `renderFriends` – כרטיס עם מספר וטבעת התקדמות, מסלול באטל פאס (`.bp`: 10 שלבים, כרטיסי פרס, פס התקדמות, גלילה לשלב הבא), איך זה עובד, מי הצטרף והקישור. "הזמנת חבר" בתפריט החשבון פותח את העמוד.
- סרטון הסבר על תוכנית החברים: `promo/video12.html` (קנבס, `renderAll` שומר פריימים לשרת מקומי) → `promo/video12.mp4`, מוצג בעמוד חברים (`.fr-vid`).
- "לנסות בלי להירשם": קודם הסרטון `promo/video9.mp4` (`demoIntro`, פעם אחת בכל ביקור – sessionStorage `demoVid`), ובסוף או בדילוג `openDemo`. ה-service worker לא נוגע בסרטונים.
- `refs/{refUid}/joined/{newUid}` {name, at} – הזמנת חברים עם קישור אישי (`?r=<uid>` → localStorage `refBy` → `refJoin` בכניסה, רק למשתמש שנוצר ב-3 הימים האחרונים; הכללים מרשים רק כשאין עדיין `stats/{newUid}`). גם `stats.ref`. `inviteDialog` מראה התקדמות; רק למי שב-`INVITE_POP_HASH` (`refDeal`): ב-`REF_GOAL`=7 חברים `refLoad` מעלה את `DAILY.ocr` ל-`REF_OCR`=7 (השרת מרשה עד 14). בניהול האתר: עמודות "הביא חברים" ו"הגיע דרך", ושיוך ידני (`admRefDialog`, כפתור `.adm-ref`; בכללים בעל האתר יכול ליצור/למחוק `refs` ולעדכן רק `stats.ref`).
- `shares/{id}` – מחברות משותפות (mode: view | copy | edit), עם `presence`. מחברות ששותפו איתי (`users/{uid}/shared`, `sharedList`) מופיעות ככרטיס גדול במסך המחברות (`renderShared`) וגם בצד (`#sideShared` ב-`renderSide`); מחברת שלי ששיתפתי (`shareId`) מקבלת תווית 👥.

## מכסה יומית ל-AI
מכסת Gemini של כל האתר יחד (Free tier, נבדק ב-AI Studio ב-4.11.2026): Flash 20 ביום ו-5 בדקה, Flash Lite 500 ביום ו-15 בדקה. בינתיים כל האתר על Lite. Flash שמור למנוי פרו עתידי: הבחירה ב-`aiModels()`, והמתג הוא `isPro()` (כרגע false). מנוי אמיתי דורש תשלום ובדיקה בשרת, כי בדיקה בדפדפן אפשר לעקוף. `gemini-2.5-flash` ו-`gemini-2.5-flash-lite` הוסרו.
- `DAILY = { ocr: 3, sum: 2, qa: 3, fc: 3, chat: 21, cf: 3, kit: 3, pr: 3, wr: 5 }` (תמונה לטקסט – לפי מספר תמונות, סיכום, עבודה מהמורה, כרטיסיות, הודעות לעוזר הלימודי, קבצים שמעלים לעוזר, שאלונים ודפי חזרה, דף תרגול דומה – `prDialog`, כתיבה עם AI – `wrDialog`: כותב לתוך המחברת במקום הסמן, רעיונות לפי מקצוע (`wrIdeas` / `WR_SUBJ`), אפשר לצרף צילום של המשימה; בצד השרת נספר כ-chat, ומבקש חיפוש Google (`aiSearchNow` → `search`, מקורות חוזרים ב-`aiLastSrc`; עובד רק אחרי deploy חדש של השרת). המכסה נבדקת בדפדפן ונשמרת ב-`meta/usage` עם `day` (ימים מ-1970 לפי שעון ישראל, `usageDay`). הכללים ב-firestore.rules מאפשרים למונה רק לעלות (אין איפוס, מחיקה או קפיצה ליום אחר) – נבדק באמולטור. עדיין אפשר לעקוף אם קוראים ל-AI ישירות בלי `useOne`; חסימה מלאה דורשת Cloud Function (תוכנית Blaze). מתאפס בחצות.
- 🔒 שרת AI: `functions/index.js` (Cloud Function `ai`, אזור europe-west1, Gemini דרך `@google/genai` עם הסוד `GEMINI_API_KEY`). סופר כל קריאה ב-`aiQuota/{uid}` (לקוח לא יכול לכתוב שם) לפי `LIMIT` (קצת יותר מ-DAILY, כי פעולה אחת = כמה קריאות) ו-10 בדקה. בצד האתר: `AI_VIA_SERVER` (true – השרת עלה ב-7.11.2026), `aiServerModel` מחקה את generateContent/generateContentStream, ו-`aiKindNow` אומר לשרת איזה סוג לספור. מדריך הפעלה למשתמש: `SERVER_SETUP.md`. אחרי שעובר ל-true – להגיד למשתמש להשבית את Firebase AI Logic API (שלב 6).
- עומס (9.11.2026): בשרת תור לכל האתר (`takeGlobal`, `aiQuota/_site`, עד `GLOBAL_PER_MIN`=14 בדקה, מחכה עד 25 שנ׳ ואז `site-busy`), ובקשה שנכשלה מחזירה את השימוש (`refundOne`). בדפדפן: אין ניסיון חוזר על 429/`site-busy`; רשימת המחברות מצוירת רק כשהיא על המסך; קבצים נקראים במקביל (`getFileBlob`) ונכתבים 4 במקביל; רשימת השיחות מאינדקס קטן `users/{uid}/chatIdx` (`chatIdxSave`, `chatFetchList`, הסבה חד-פעמית לפי localStorage `chatIdx:<uid>`).
- ניהול האתר – "AI היום בכל האתר" (`admSiteAi`, `SITE_AI_DAY`=500): השרת סופר ב-`takeGlobal(kind)` גם `day`, `today`, `kinds`, `prevDay` ב-`aiQuota/_site`, ורק בעל האתר יכול לקרוא אותו (כלל ב-firestore.rules). בטלפון טבלת המשתמשים היא כרטיסים (`data-l` לכל תא). `INVITE_POP_HASH` – חלון ההזמנה קופץ למשתמשים שסוכם איתם.
- `UNLIMITED_HASH` – החשבון בלי הגבלה, כ-SHA-256 של `my-notebooks:` + האימייל באותיות קטנות. לא לכתוב אימיילים גלויים בקוד, כי כל אחד יכול לראות אותו ב-F12.
- ייבוא מערכת שעות / לוח מבחנים / ציונים – לא נספר במכסה.

## עוזר לימודי
חלון צ'אט אחד (`#chatPanel`) בשני מקומות: כרטיסייה במסך מלא (`chatView`, עוזר כללי), ובועה מעל מחברת (קורא את המחברת). `chatPlace(v)` מזיז אותו. כל פתיחה של העוזר (כרטיסייה, בועה, מסך הבית) מתחילה שיחה חדשה (`chatFresh`); שיחות ישנות רק דרך "השיחות שלי". פעולות: JSON בתחילת התשובה בלבד (`chatSplit`): `ADD_TO_CALENDAR` (התאריך מההודעה דרך `parseQuick`), `QUIZ` ו-`SHEET` (כרטיסים בצ'אט: `chatQuizEl`, `chatSheetEl`, נשמרים בתוך `history[].card`). ב-Firestore אין מערך בתוך מערך, ולכן שורות הטבלה הן `{c: [...]}`.

העוזר ברמה גבוהה (7.11.2026): `chatFill` מציג Markdown (כותרות, **מודגש**, רשימות, טבלאות, קוד) ונוסחאות LaTeX ב-$...$ עם KaTeX מ-jsdelivr (`chatMath`, `texPlain` לטקסט רגיל). ```svg בתשובה = ציור (מוצג כ-<img>, אז קוד לא רץ; `chatImage` עם הורדה / למחברת דרך `addImages`). תמיד בזרם דרך השרת, כפתור עצירה (`chatStopper`), כפתורים מתחת לתשובה (`chatTools`: העתקה, הקראה, למחברת, תשובה אחרת), הצעות המשך משורה שמתחילה ב->> (`chatNextIdeas`), 🔎 חיפוש באינטרנט (`chatWeb` → מקורות ב-`src`). קישור בהודעה (`CHAT_URL` → `chatLinks` → `aiUrlsNow`) שולח לשרת `urls: true`, והשרת מוסיף את הכלי `urlContext` של Gemini שקורא את הדף (נוסף 9.11.2026, עובד רק אחרי deploy של השרת). JSON של פעולה מזוהה גם באמצע התשובה (`chatSplit`). קבצים שמצרפים לעוזר נשמרים בענן כמו ביומן (`uploadFile` ברקע ב-`chatAddFiles`), מופיעים מתחת להודעה עם פתיחה/הורדה (`chatFileChips`, `history[].files`), ובשיחה ישנה תמונות ו-PDF נטענים שוב לעוזר (`chatMem[].fid` → `chatRestoreMem`). יצירת תמונה אמיתית: `CHAT_IMG` → `chatMakeImage` → שרת עם `image: true` (kind `img`, 4 ביום, `IMAGE_MODELS`); התמונה לא נשמרת בשיחה (גדולה מדי ל-Firestore).

עוד בעוזר (8.11.2026): **מצב מורה** (`chatTeach`, צ'יפ `#chatTeach`, נשמר ב-localStorage) מוסיף לפרומפט `CHAT_TEACH` – לא נותן תשובות, שאלה אחת ורמזים. **בדיקת שיעורי בית** (צ'יפ עם `check: true` ב-`CHAT_ACTIONS` ובהצעות) – פותח צירוף קובץ, והפרומפט אומר לסמן ✓/✕ ולהסביר בלי לפתור. **העוזר מכיר אותך**: `chatAboutMe` (מערכת שעות + ממוצעים מ-`gradeAvgs`) בפרומפט, ו-`chatInsight` מציג כרטיס אישי בשיחה ריקה (מבחן קרוב / ממוצע נמוך). **מיקרופון** `#chatMic` (Web Speech, he-IL) – ממלא את התיבה ושולח בסוף. **תוכנית למידה למבחן חדש**: לא נכנסות חזרות ליומן לבד (המשתמש ביקש – זה הציף את היומן). `autoPlan` רק מציג הודעה עם כפתור "בניית תוכנית" (`planDialog`).

העוזר מכיר את כל המחברות (10.11.2026): `chatAllNotebooks` בפרומפט – בעוזר הכללי קטעים מכל המחברות (החדשות קודם, עד 24,000 תווים, `nbPlain` עם מטמון לפי updatedAt), וכשמחברת פתוחה רק שמות השאר.

העוזר זוכר אותך (10.11.2026): עובדות קבועות שהמשתמש סיפר (כיתה, מה קשה לו) – העוזר כותב שורה `@@ ...` בסוף התשובה (מוסתרת ב-`chatFill`), `aiMemFrom` → `aiMemAdd` שומר ב-`users/{uid}/meta/aimem` {items: [{id, t, at}]}, עד 40. בפרומפט דרך `aiMemPrompt`. מתחת לתשובה "זכרתי: ..." עם "לשכוח" (`aiMemNote`), וניהול מתפריט החשבון (`#aiMemBtn` → `aiMemDialog`).

שינוי ביומן מהעוזר (10.11.2026): ברשימת היומן בפרומפט לכל דבר יש `[id]`; פעולה `UPDATE_CALENDAR` (`items: [{id, date?, time?, title?, done?, delete?}]`) → `chatUpdateEvents` → `chatUpdatedCard` עם ביטול. הפרומפט אוסר להגיד "שיניתי ביומן" בלי JSON. חיפוש אוטומטי: `CHAT_SEARCH` מדליק `chatAutoWeb` להודעה אחת.

עריכת המחברת מהעוזר (10.11.2026): פעולה `EDIT_NOTEBOOK` (`edits: [{op: after|before|replace|append, find, text}]`, ההוראות ב-`CHAT_EDIT_RULES` – רק כשיש מחברת פתוחה שאפשר לערוך). `chatEditPrep` מסנן מה שלא נמצא (`edFindBlock`), `chatEditCard` מראה מה ישתנה עם "לשנות במחברת", `chatEditApply` משנה ומהבהב (`.ai-flash`), ויש ביטול. הטקסט עובר `edTextToHtml` ו-`clean`.

מערכת שעות מהעוזר: צילום/PDF + הודעה שמתאימה ל-`CHAT_TT` ("תכניס למערכת שעות") → `timetableDialog(file)` נפתח וקורא את הקובץ מיד (`readTT`), והמשתמש בודק ושומר. הקובץ עצמו שמור ב-`chatPending[].file`.

סיור ראשון: משתמש שנרשם בשבוע האחרון מקבל בכניסה הראשונה חלון ברוכים הבאים (`welcomeMaybe` → `welcomeCard`) ואז סיור עם זרקור על הדברים האמיתיים במסך (`runTour`, הצעדים ב-`TOUR`). "אחר כך" משאיר כפתור `#tourChip`. נשמר ב-localStorage `tour:app:<uid>`. אפשר להפעיל שוב מתפריט החשבון (🧭 סיור באתר, `#tourBtn`).

העוזר בולט (8.11.2026): במחשב כרטיס צבעוני `.side-ai` מעל התפריט בצד; בטלפון כפתור צבעוני באמצע הסרגל `.tb-ai` (בגובה של השאר – המשתמש לא רצה שיבלוט למעלה ויסתיר) (שניהם `ai-nav`, והסימון שמחליק ב-motion.js מדלג עליהם); ובמסך הבית התיבה של העוזר נמצאת בתוך ה-hero, מעל האריחים, עם מסגרת צבעונית.

מסך הבית: התיבה `#haInput` שולחת לעוזר ועוברת לעמוד שלו (`homeAsk`). ההוספה המהירה הישנה (`#quickAdd`) מוסתרת, והקוד שלה נשאר כי אלמנטים שלה נטענים בפתיחה.

## עורך המחברת (כמו Docs/Canva, 9.11.2026)
אזור `עורך כמו Google Docs / Canva` ב-app.js: נטוי, קו חוצה, צבע/מרקר בצבעים/גודל (`#styleBtn` → `applyInline`/`applyHl` דרך `wrapSel` – foreColor עם צבע-דגל ואז הופכים ל-`span[data-c|data-s]`/`mark[data-c]`), רשימת משימות `ul[data-check]` + `li[data-done]` (`toggleChecklist`, לחיצה על הריבוע – `checkHit`), ציטוט `blockquote` (`convertBlock`), קו `hr`, קישורים (`linkDialog`, Ctrl+K, חלונית `lk-pop`), תפריט הוספה `#insBtn` ו-"/" בשורה (`INS`, `slashCheck`) עם תבניות (`TPL`), קיצורי Markdown ("- ", "1. ", "# ", "> ", "[] ", "---"), חיפוש והחלפה (`findOpen`, Ctrl+F/H, CSS Highlight API), מונה מילים `#edStats`, קיצורים (`keysDialog`, Ctrl+/). אחרי פקודות רשימה – `fixNest()` (כרום שם רשימה בתוך p).
עוד (9.11.2026): בועת הסבר לכל כפתור (`TIPS`, `tbTipWire` – מעבר עכבר, בטלפון לחיצה ארוכה), כפתור ? בסוף הסרגל (`#tbHelp`) שמריץ סיור `TB_TOUR` דרך `runTour(steps, onEnd)` (פעם ראשונה אוטומטית, `tour:tb1`), סרגל צף כשמסמנים טקסט (`selBub`), וידית ליד כל שורה במחשב (`.blk-h`: + לשורה חדשה עם תפריט /, גרירה להזזה, לחיצה – `blockMenu`: להפוך ל..., שכפול, הזזה, מחיקה עם ביטול; Alt+Shift+חצים מזיזים שורה).
עריכה משותפת: `applyRemoteHtml` מחליף רק את הבלוקים שהשתנו (לא את כל העורך), כדי שהסמן וההקלדה לא יקפצו. הסמן של החבר נמצא לפי האותיות שלפניו (`cx`, `findCaret`), והעכבר שלו מוסתר כשהוא מקליד (`ct` > `mt`).

מתמטיקה במחברת (12.11.2026): כפתור `#mathBtn` (אייקון `i-sigma`) → `mathOpen` → לוח שאפשר להזיז `.math-dock` (`mathDockShow`/`mathDockHide`, גרירה מהכותרת, מיקום ב-localStorage `mathDockPos`, X סוגר – `mathDock:<nbId>`=off). במחברת שהמקצוע או השם שלה מתאימים ל-`MATH_NB` הוא נפתח לבד (`isMathNb` ב-`openNotebook`). בלוח: סימנים (`MATH_SYMS`), חזקה/אינדקס (sup/sub), שבר `span[data-frac]>span[data-n]+span[data-d]` (נשמר ב-`clean`, מוכנס ישירות עם Range – לא insertHTML), שורת משוואה `mathLine` (p עם dir=ltr ו-data-a=center). הקלדה של x^2 ורווח הופכת ל-x² (`SUPS`). גם בתפריט ההוספה ו-/ (קבוצה "מתמטיקה").

צורת המחברת (9.11.2026): שדה `layout` במחברת ('' = עמוד אינסופי, `pages`, `slides`). "מחברת חדשה" (`newNotebook`): שלב אחד – שם+מקצוע+צבע ו"יצירה" מיד (המשתמש ביקש: היצירה הייתה ארוכה); "עוד אפשרויות" פותח את השלבים: צורה ← רקע/כיוון/שוליים ← גופן/גודל ← תבנית מ-`TPL`. אחרי יצירה מהירה – הודעה עם "להתאמה" (`nbSettingsDialog`). עוד שדות: `bg` (lines/grid/dots), `orient` (land), `margin` (narrow/wide), `font` (clean/round/hand), `fs` (s/l), `subject` – אפשרויות ב-`NB_OPTS`, הכרטיסים ב-`nbSettingsUI`, ובדיקה ב-`lookOf`; `applyLook` שם אותם כ-data על `#editor` ו-`.page`. משנים מראש המחברת: כפתור "הגדרות" (`#nbLayout` → `nbSettingsDialog`, לא לחבר שעורך). `setLayout(lay, convert)` שם `data-layout` על `#editor` ועל `.page`. דפים: `paginate` נותן `margin-top` זמני לשורה שלא נכנסת (clean מוחק, לא נשמר) ומצייר דפים ב-`.pg-sheets`. שקופיות: `div[data-slide]` (ב-`clean`), `slideFix` (ב-`markDirty`) שומר שכל התוכן בתוך שקופית, `addSlide` / `#slideAdd`, מחיקה בקצה שקופית לא מדביקה שקופיות. גם ב-shares (`layout`).

תמונה לטקסט: למחברת לא נכנס [?] – רק הניחוש (המשתמש ביקש). בתצוגה לפני ההוספה מילים לא בטוחות עדיין מסומנות בצהוב עם "אולי".

## כללים חשובים
1. **לפני כל העלאה – בדיקת תחביר כמודול:** `cp app.js /tmp/a.mjs && node --check /tmp/a.mjs`. (`node --check app.js` לבד לא תופס שגיאות – ככה פעם עלה באג ששבר את כל האתר.)
2. **בכל העלאה – להעלות מספר גרסה**, אחרת הדפדפן והטלפון ממשיכים להציג את הישנה:
   - ב-`index.html`: `app.js?v=...`, `style.css?v=...` ו-`motion.js?v=...`
   - ב-`sw.js`: `const CACHE = 'notebooks-...'`
   ```bash
   v=$(date +%s); sed -i -E "s/app\.js\?v=[0-9]+/app.js?v=$v/; s/style\.css\?v=[0-9]+/style.css?v=$v/; s/motion\.js\?v=[0-9]+/motion.js?v=$v/" index.html; sed -i -E "s/(const CACHE *= *['\"][^'\"]*-)[0-9]+/\1$v/" sw.js
   ```
3. העלאה = `git push` ל-main. GitHub Pages מתעדכן תוך כדקה. לפעמים GitHub מחזיר שגיאת 500 – פשוט לנסות שוב.
4. כל HTML שנכנס למחברת עובר דרך `clean()` – רשימה סגורה של תגיות ותכונות (`ALLOWED`). תכונה חדשה שצריכה להישמר (כמו `dir`, `data-a`) – להוסיף שם.
5. חלונות: `dialog(build)` / `closeDialog()`. הודעות: `toast(msg)`, `toastAction(msg, label, fn)`. הסבר בפעם הראשונה: `introOnce(key)` עם `INTROS` ו-`ILL` (איורי SVG). הסבר עם חצים על חלקים בתוך חלון: `coachTour(d, [[אלמנט, טקסט], ...])` (בשימוש ב-`prDialog`).
6. AI: `aiText` (זרם HTML), `aiExtract` / `aiJson` (JSON), `notebookParts()` (טקסט ותמונות מהמחברת).
7. חלון עם `<input type=file>` מקבל אוטומטית גרירה והדבקה של קבצים (`dialogFileInput` / `feedInput`).
8. תשובות AI שנכנסות למחברת – בלי הערות מיותרות (ראה `qaForNotebook`).
10. **בלי אימוג'ים באתר** (המשתמש ביקש): רק אייקונים בקו מה-sprite ב-index.html (`#i-...`). ✓ ו-✕ מותרים. תשובות AI עוברות `noEmoji` (בצ'אט וב-`prHtml`).
11. הקראה (`ttsSpeak`): בוחרים קול he/iw בעצמנו, מחלקים לחתיכות של עד 180 תווים, ומתחילים בתוך הלחיצה (iPhone). אם אין קול בעברית – חלון עם הסבר איך להתקין.
12. צבע של מחברת: כפתור "צבע" בראש המחברת (`nbColorDialog`, גם לחיצה על הפס הצבעוני).
13. כיוון טקסט: `smartDir` בתחילת app.js הופך כל `dir="auto"` (חוץ מבתוך `#editor`) ל-rtl אם יש בטקסט עברית, ול-ltr רק כשאין עברית בכלל – ומתעדכן לבד כשהטקסט משתנה. בטקסט חדש עם כיוון – להשתמש ב-`dir="auto"` כרגיל.
9. לבדוק גם בטלפון (רוחב 390). יש מצב כהה: `html[data-theme="dark"]`.
