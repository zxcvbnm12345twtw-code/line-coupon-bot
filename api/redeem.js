const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);

export default async function handler(req, res) {
  const { code } = req.query; // 從網址取得優惠碼

  try {
    await doc.loadInfo();
    const logSheet = doc.sheetsByTitle['user_log'];
    const rows = await logSheet.getRows();

    // 在 Log 裡面找到這組序號，且還沒被核銷過的
    const targetRow = rows.find(row => row.get('coupon_code') === code && row.get('is_redeemed') !== 'YES');

    if (targetRow) {
      targetRow.set('is_redeemed', 'YES');
      targetRow.set('redeemed_at', new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }));
      await targetRow.save();

      // 回傳一個簡單的 HTML 成功畫面給櫃姐看
      res.setHeader('Content-Type', 'text/html');
      return res.status(200).send(`
        <body style="text-align:center; font-family:sans-serif; padding-top:50px;">
          <h1 style="color:green; font-size:50px;">✅ 核銷成功</h1>
          <p style="font-size:24px;">序號：${code}</p>
          <p style="font-size:24px;">此優惠券已失效，請提供折扣。</p>
        </body>
      `);
    } else {
      res.setHeader('Content-Type', 'text/html');
      return res.status(200).send(`
        <body style="text-align:center; font-family:sans-serif; padding-top:50px;">
          <h1 style="color:red; font-size:50px;">❌ 無效或已核銷</h1>
          <p style="font-size:24px;">此序號無法重複使用。</p>
        </body>
      `);
    }
  } catch (err) {
    return res.status(500).send('系統錯誤');
  }
}
