# Qadam — menejerlar kunlik ishi (amoCRM + onlinePBX)

Mustaqil ishlaydigan dashboard. Har 10 daqiqada amoCRM va onlinePBX'dan ma'lumot oladi va har bir menejer bo'yicha quyidagilarni ko'rsatadi:

- **Holat:** Ishladi / Sust / Ishlamadi
- **Ish vaqti (8 soatlik me'yor):** keldi, ketdi, faol soat, 8 soatdan qancha kam ishlagani, bo'sh soat, eng uzun tanaffus, 30 daqiqadan uzun tanaffuslar soni
- **Voronka:** yangi lid, Взято, Квал, Счет, to'lov, summalar, CR, Закрыто
- **Qo'ng'iroqlar** (onlinePBX): zvonok, dozvon, suhbat daqiqasi, birinchi qo'ng'iroq vaqti
- **Reglament kamchiliklari R1–R9**, har biri lid havolasi bilan
- **Gigiyena:** muddati o'tgan vazifalar, vazifasiz lidlar, 7 kundan ortiq ОЖОП'da turgan lidlar, olinmagan yangi lidlar
- **Kun / Hafta / Oy:** "Ishlayapti", "Nazoratda" va "Ishlamayapti" ro'yxatlari

---

## 1-qadam. amoCRM tokenini olish (≈3 daqiqa)

Bu ishni amoCRM'da **administrator** huquqi bor odam qilishi kerak.

1. amoCRM → **Настройки → Интеграции** → o'ng yuqoridagi **"Создать интеграцию"** → **"Внешняя интеграция"**ni tanlang.
2. Nom bering, masalan "Qadam dashboard". Ruxsatlarda (Доступы) **"Доступ к данным аккаунта"**ni belgilang va saqlang.
3. Yaratilgan integratsiyani oching → **"Ключи и доступы"** bo'limi → **"Сгенерировать долгосрочный токен"**. Muddatini eng uzun qilib tanlang (masalan, 5 yil).
4. Chiqqan uzun matnni nusxalang. Bu **AMO_TOKEN**.

> Tokenni hech kimga yubormang va chatga yozmang. Uni faqat Railway sozlamalariga qo'yasiz.

## 2-qadam. onlinePBX API kalitini olish (≈1 daqiqa)

1. `panel.onlinepbx.ru` → chap menyuda **"Интеграция" → "API"**.
2. **API kalit** (auth key) ni nusxalang. Bu **PBX_API_KEY**.
3. Domeningiz: **pbx18476.onpbx.ru** (sozlamada shunday turibdi).

## 3-qadam. Railway'ga joylash (≈10 daqiqa)

**A) GitHub orqali (tavsiya etiladi):**
1. GitHub'da yangi **private** repozitoriy oching va shu papkadagi barcha fayllarni yuklang. `node_modules` va `data` papkalari kerak emas.
2. railway.com → **New Project → Deploy from GitHub repo** → repozitoriyni tanlang.

**B) GitHub'siz:** kompyuteringizga Railway CLI o'rnatib, shu papkada `railway up` buyrug'ini bering.

**Keyin (ikkala holatda ham):**

3. Servis → **Variables** bo'limiga quyidagilarni kiriting (namuna `.env.example` faylida):

   | O'zgaruvchi | Qiymat |
   |---|---|
   | `AMO_DOMAIN` | `qadamsales.amocrm.ru` |
   | `AMO_TOKEN` | 1-qadamdagi token |
   | `PBX_DOMAIN` | `pbx18476.onpbx.ru` |
   | `PBX_API_KEY` | 2-qadamdagi kalit |
   | `DASH_USER` | dashboard login (masalan `qadam`) |
   | `DASH_PASS` | kuchli parol |
   | `DATA_DIR` | `/data` |

4. Servis → **Settings → Volumes → Add Volume**, Mount path: **`/data`**. Shunda qayta ishga tushganda ma'lumot yo'qolmaydi.
5. **Settings → Networking → Generate Domain**. Railway sizga `xxx.up.railway.app` manzil beradi.
6. Shu manzilni oching, login va parolni kiriting.

Birinchi ishga tushganda dastur oxirgi 35 kunni yig'adi. Bu **20–40 daqiqa** oladi: amoCRM sekundiga 7 tadan ortiq so'rovga ruxsat bermaydi. Bugungi kun birinchi bo'lib, bir necha daqiqada chiqadi.

## Sozlamalar (ixtiyoriy)

| O'zgaruvchi | Standart | Nima qiladi |
|---|---|---|
| `WORK_HOURS` | `8` | Kunlik ish me'yori, soatda |
| `SYNC_MINUTES` | `10` | Bugungi kun har necha daqiqada yangilanadi |
| `DAYS_BACK` | `35` | Necha kunlik ma'lumot saqlanadi |
| `EXCLUDE_USER_IDS` | `9723882` | Hisobga olinmaydigan amoCRM foydalanuvchilari (admin) |
| `EXT_MAP` | `{"127":"iroda ppx 127",...}` | Ichki raqam → amoCRM'dagi menejer nomi (avtomatik topilmaganlar uchun) |
| `SALES_PIPELINES` | UZUM, Videochat, Fenix, AI, YouTube, Exode, WB, Data, Buxgalteriya, Reanimatsiya, Kommyuniti | Savdo voronkalari ID'lari, vergul bilan |
| `R6_PIPELINES` | Reanimatsiya va Kommyuniti'siz | Yangi lidga reaksiya (R6) tekshiriladigan voronkalar |

**Ichki raqam qanday bog'lanadi:** amoCRM'dagi menejer nomidagi 3 xonali raqam ("Сарвиноз - pbx 100" → 100) onlinePBX'dagi ichki raqamga bog'lanadi. Nomida raqam bo'lmaganlar `EXT_MAP` orqali qo'shiladi.

## Hisoblash qoidalari

- **Kun** Toshkent vaqti bilan 05:00 dan ertasi 05:00 gacha. Tungi qo'ng'iroqlar oldingi kunga yoziladi.
- **Faol vaqt:** amoCRM'da harakat (bosqich, vazifa, izoh, chat va hokazo) yoki qo'ng'iroq bo'lgan 15 daqiqalik bo'laklar yig'indisi.
- **Bo'sh vaqt:** kelgan va ketgan vaqt oralig'idan faol vaqt ayirilgani.
- **Ishladi:** 15+ dozvon, 60+ daqiqa suhbat va 5+ soat faol. **Ishlamadi:** 10 tadan kam zvonok va 10 tadan kam CRM harakat.
- **Hafta/Oy hukmi:**
  - **Ishlayapti** — kunlarning 70%+ qismida "Ishladi", o'rtacha 6+ soat faol, kuniga 5 tadan kam kamchilik.
  - **Ishlamayapti** — "Ishladi" kunlari 40% dan kam yoki o'rtacha 4 soatdan kam faol.
  - Qolganlari — **Nazoratda**.
- **R1–R9** — "AmoCRMda ishlash qoidalari" bo'yicha: NDZ'da 6 ta qo'ng'iroq, izoh, sabab, yangi lidga 10 daqiqada qo'ng'iroq va hokazo. To'liq ro'yxat dashboard'ning "Kamchiliklar" tabida.
- **Dozvon:** onlinePBX'da haqiqiy suhbat vaqti 0 dan katta bo'lgan qo'ng'iroq. Gudok vaqti hisoblanmaydi.

## Tekshirish

- `https://<manzil>/health` — oxirgi sinxronizatsiya vaqti va xatosi (login so'ramaydi).
- Railway → **Deployments → Logs** bo'limida `[sync]` yoki `[pbx]` bilan boshlanadigan xatolar ko'rinadi.

## Mahalliy ishga tushirish

```bash
npm install
AMO_TOKEN=... PBX_API_KEY=... DASH_PASS=... node server.js
# http://localhost:3000
```
