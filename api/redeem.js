const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

// 1. Google Sheets 認證配置 (維持不變)
const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);

// 2. HTML 範本函數 - 生成專業美觀的介面
function generateHtml(status, title, message, code) {
  const isSuccess = status === 'success';
  const primaryColor = isSuccess ? '#28a745' : '#dc3545'; // 綠色/紅色
  const icon = isSuccess 
    ? `<svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="${primaryColor}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`
    : `<svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="${primaryColor}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;

  return `
  <!DOCTYPE html>
  <html lang="zh-TW">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>門市核銷系統</title>
    <style>
      body {
        background-color: #f0f2f5;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100vh;
        margin: 0;
        padding: 20px;
        box-sizing: border-box;
      }
      .card {
        background-color: white;
        padding: 40px;
        border-radius: 16px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.1);
        text-align: center;
        width: 100%;
        max-width: 400px;
        animation: scaleUp 0.3s ease-out;
      }
      @keyframes scaleUp {
        from { transform: scale(0.9); opacity: 0; }
        to { transform: scale(1); opacity: 1; }
      }
      .icon-container {
        margin-bottom: 25px;
        display: inline-block;
        padding: 15px;
        border-radius: 50%;
        background-color: ${isSuccess ? '#d4edda' : '#f8d7da'};
      }
      h1 {
        color: ${primaryColor};
        margin: 0 0 15px 0;
        font-size: 28px;
        font-weight: 700;
      }
      .hr-line {
        border: 0;
        border-top: 1px solid #eee;
        margin: 25px 0;
      }
      .code-label {
        color: #666;
        font-size: 14px;
        margin-bottom: 8px;
        text-transform: uppercase;
        letter-spacing: 1px;
      }
      .code-value {
        font-size: 32px;
        font-weight: bold;
        color: #333;
        letter-spacing: 2px;
        background-color: #f9f9f9;
        padding: 12px;
        border-radius: 8px;
        display: inline-block;
        margin-bottom: 25px;
        border: 1px solid #eee;
      }
      .message {
        color: #666;
        font-size: 18px;
        line-height: 1.5;
        margin: 0;
      }
      .footer {
        margin-top: 35px;
        font-size: 12px;
        color: #aaa;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="icon-container">
        ${icon}
      </div>
      <h1>${title}</h1>
      
      <div class="hr-line"></div>
      
      <p class="code-label">優惠券序號</p>
      <div class="code-value">${code}</div>
      
      <p class="message">${message}</p>
      
      <div class="footer">門市自動化核銷系統 V1.1</div>
    </div>
  </body>
  </html>
  `;
}

// 3. Webhook 主處理器
export default async function handler(req, res) {
  const { code } = req.query; // 從網址取得優惠碼

  // 設置 Content-Type 確保中文正常顯示
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  try {
    await doc.loadInfo();
    const logSheet = doc.sheetsByTitle['user_log'];
    const rows = await logSheet.getRows();

    // 在 Log 裡面找到這組序號，且還沒被核銷過的 (is_redeemed != 'YES')
    const targetRow = rows.find(row => row.get('coupon_code') === code && row.get('is_redeemed') !== 'YES');

    if (targetRow) {
      // --- 執行核銷：更新 Sheet ---
      targetRow.set('is_redeemed', 'YES');
      targetRow.set('redeemed_at', new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }));
      await targetRow.save();

      // --- 回傳美化後的「成功」畫面 ---
      return res.status(200).send(generateHtml(
        'success',
        '核銷成功',
        '此序號已失效，請提供顧客折扣。',
        code
      ));
    } else {
      // --- 回傳美化後的「失敗」畫面 (可能重複領取或代碼錯誤) ---
      return res.status(200).send(generateHtml(
        'error',
        '無效或已核銷',
        '此序號無法重複使用或查無此紀錄。',
        code || 'UNKNOWN'
      ));
    }
  } catch (err) {
    console.error('Redeem API Error:', err);
    return res.status(500).send('<h1>系統錯誤，請稍後再試</h1>');
  }
}
