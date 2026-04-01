const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);

// 取得台北時間
function nowTaipei() {
  return new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
}

// HTML模板
function generatePage(type, code, message) {
  const isConfirm = type === 'confirm';
  const isSuccess = type === 'success';

  return `
  <html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>門市核銷系統</title>
    <style>
      body { font-family: sans-serif; text-align:center; padding:40px; }
      .btn {
        background:#28a745;
        color:white;
        padding:15px 25px;
        border:none;
        border-radius:8px;
        font-size:18px;
        margin-top:20px;
      }
      .btn-danger {
        background:#dc3545;
      }
    </style>
  </head>
  <body>
    <h2>優惠碼：${code}</h2>
    <p>${message}</p>

    ${
      isConfirm
        ? `
        <form method="POST">
          <input type="hidden" name="code" value="${code}" />
          <button class="btn">確認核銷</button>
        </form>
      `
        : ''
    }

  </body>
  </html>
  `;
}

// 主入口
export default async function handler(req, res) {
  const code = req.method === 'POST' ? req.body.code : req.query.code;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  if (!code) {
    return res.status(200).send(generatePage('error', 'UNKNOWN', '缺少優惠碼'));
  }

  await doc.loadInfo();
  const sheet = doc.sheetsByTitle['user_log'];
  const rows = await sheet.getRows();

  const row = rows.find(r => r.get('coupon_code') === code);

  if (!row) {
    return res.status(200).send(generatePage('error', code, '查無此優惠碼'));
  }

  const isUsed = row.get('is_redeemed') === 'YES';

  // ✅ GET：只顯示確認頁（不核銷）
  if (req.method === 'GET') {
    if (isUsed) {
      return res.status(200).send(generatePage('error', code, '此優惠碼已核銷'));
    }
    return res.status(200).send(generatePage('confirm', code, '請確認是否進行核銷'));
  }

  // ✅ POST：才真正核銷
  if (req.method === 'POST') {
    if (isUsed) {
      return res.status(200).send(generatePage('error', code, '此優惠碼已核銷'));
    }

    row.set('is_redeemed', 'YES');
    row.set('redeemed_at', nowTaipei());
    await row.save();

    return res.status(200).send(generatePage('success', code, '核銷成功'));
  }
}
