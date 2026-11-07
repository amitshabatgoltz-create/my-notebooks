# 🔒 הפעלת השרת של ה-AI (חסימה מלאה)

אחרי השלבים האלה, כל בקשה ל-AI עוברת דרך שרת שסופר אותה, ואף אחד לא יכול לעקוף את המכסה.
את השלבים עושים **פעם אחת**. האתר ממשיך לעבוד רגיל כל הזמן, גם באמצע.

## שלב 1 – עם הורה: מעבר לתוכנית Blaze (5 דקות)
1. נכנסים ל-https://console.firebase.google.com/project/my-notebooks-32ffd/usage/details
2. לוחצים **Upgrade** ← בוחרים **Blaze** ← מוסיפים כרטיס אשראי.
3. כשהוא שואל על תקציב (Budget) – לכתוב **5$**. ככה מקבלים מייל אם משהו מתחיל לעלות כסף.
   (באתר בגודל שלנו זה אמור לעלות 0, או לכל היותר כמה אגורות בחודש.)

## שלב 2 – מפתח ל-Gemini (2 דקות)
1. נכנסים ל-https://aistudio.google.com/apikey
2. **Create API key** ← בוחרים את הפרויקט **my-notebooks-32ffd**.
3. מעתיקים את המפתח ושומרים אותו בצד (לא לשלוח אותו לאף אחד, גם לא בצ'אט).

## שלב 3 – במחשב: מתקינים כלים (פעם אחת)
1. מורידים ומתקינים **Node.js** (הגרסה שכתוב עליה LTS): https://nodejs.org
2. מורידים את הפרויקט: https://github.com/amitshabatgoltz-create/my-notebooks ← **Code** ← **Download ZIP** ← מחלצים.
3. פותחים את התיקייה שחולצה, לוחצים בשורת הכתובת למעלה, כותבים `cmd` ולוחצים Enter. נפתח חלון שחור.

## שלב 4 – מעלים את השרת (בחלון השחור, פקודה אחרי פקודה)
```
npm install -g firebase-tools
```
```
firebase login
```
(נפתח דפדפן – נכנסים עם החשבון של Google שבו נמצא ה-Firebase)
```
cd functions && npm install && cd ..
```
```
firebase functions:secrets:set GEMINI_API_KEY
```
(מדביקים את המפתח משלב 2 ולוחצים Enter. לא רואים אותו כשמדביקים – זה בסדר)
```
firebase deploy --only functions
```
אם הוא שואל שאלות (להפעיל משהו, cleanup policy) – עונים **y** ו-Enter.
בסוף צריך להופיע `Deploy complete!`

## שלב 5 – להגיד לעוזר "השרת עלה"
העוזר יעביר את האתר לעבוד דרך השרת ויבדוק שהכול עובד.

## שלב 6 – לסגור את הדלת האחורית
רק אחרי שהעוזר אישר שהכול עובד דרך השרת:
1. נכנסים ל-https://console.cloud.google.com/apis/library/firebasevertexai.googleapis.com?project=my-notebooks-32ffd
2. לוחצים **Disable** (השבתה).

מעכשיו אי אפשר לפנות ל-AI ישר מהדפדפן – רק דרך השרת. זו החסימה המלאה.
