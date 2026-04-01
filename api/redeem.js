const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);

function nowTaipei() {
  return new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
}

export default async function handler(req, res) {
  const code = req.method === 'POST' ? req.body.code : req.query.code;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  if (!code) {
    return res.status(200).send('<h2>缺少優惠碼</h2>');
  }

  await doc.loadInfo();
  const sheet = doc.sheetsByTitle['user_log'];
  const rows = await sheet.getRows();

  const row = rows.find(r => r.get('coupon_code') === code);

  if (!row) {
    return res.status(200).send('<h2>查無此優惠碼</h2>');
  }

  const isUsed = row.get('is_redeemed') === 'YES';

  // ✅ 第一次進來 → 顯示確認（不核銷）
  if (req.method === 'GET') {
    if (isUsed) {
      return res.status(200).send(`
        <h2>此優惠碼已核銷</h2>
        <p>${code}</p>
      `);
    }

    return res.status(200).send(`
      <h2>優惠碼：${code}</h2>
      <p>請由門市人員確認後點擊核銷</p>

      <form method="POST">
        <input type="hidden" name="code" value="${code}" />
        <button style="font-size:20px;padding:10px 20px;">
          確認核銷
        </button>
      </form>
    `);
  }

  // ✅ 按下按鈕才核銷
  if (req.method === 'POST') {
    if (isUsed) {
      return res.status(200).send('<h2>此優惠碼已核銷</h2>');
    }

    row.set('is_redeemed', 'YES');
    row.set('redeemed_at', nowTaipei());
    await row.save();

    return res.status(200).send(`
      <h2>核銷成功</h2>
      <p>${code}</p>
    `);
  }
}
