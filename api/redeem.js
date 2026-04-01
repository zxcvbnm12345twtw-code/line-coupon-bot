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

function renderPage({ status, title, message, code, showButton = false }) {
  const themeMap = {
    confirm: {
      accent: '#1DB446',
      soft: '#E9F8EE',
      badge: '待確認',
      icon: `
        <svg viewBox="0 0 24 24" fill="none" stroke="#1DB446" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="9"></circle>
          <path d="M12 7.5v4.5l3 2"></path>
        </svg>
      `,
      buttonText: '確認核銷'
    },
    success: {
      accent: '#16A34A',
      soft: '#EAF8EE',
      badge: '核銷完成',
      icon: `
        <svg viewBox="0 0 24 24" fill="none" stroke="#16A34A" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="9"></circle>
          <path d="M8 12.5l2.5 2.5L16.5 9"></path>
        </svg>
      `,
      buttonText: ''
    },
    error: {
      accent: '#DC2626',
      soft: '#FDEEEE',
      badge: '無法使用',
      icon: `
        <svg viewBox="0 0 24 24" fill="none" stroke="#DC2626" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="9"></circle>
          <path d="M9 9l6 6M15 9l-6 6"></path>
        </svg>
      `,
      buttonText: ''
    }
  };

  const theme = themeMap[status] || themeMap.error;

  return `
  <!DOCTYPE html>
  <html lang="zh-TW">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
    <title>門市核銷系統</title>
    <style>
      :root {
        --accent: ${theme.accent};
        --soft: ${theme.soft};
        --text: #1f2937;
        --muted: #6b7280;
        --border: #e5e7eb;
        --bg: #f5f7fb;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background:
          radial-gradient(circle at top, #ffffff 0%, #f5f7fb 45%, #eef2f7 100%);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans TC", Arial, sans-serif;
        color: var(--text);
      }

      .wrap {
        width: 100%;
        max-width: 460px;
      }

      .card {
        background: #ffffff;
        border-radius: 24px;
        box-shadow: 0 18px 50px rgba(15, 23, 42, 0.10);
        overflow: hidden;
        border: 1px solid rgba(229, 231, 235, 0.9);
      }

      .top {
        padding: 28px 28px 18px;
        background: linear-gradient(180deg, var(--soft) 0%, #ffffff 100%);
        text-align: center;
      }

      .icon-box {
        width: 88px;
        height: 88px;
        margin: 0 auto 16px;
        border-radius: 999px;
        background: #ffffff;
        border: 1px solid rgba(255,255,255,0.85);
        box-shadow: 0 10px 25px rgba(0,0,0,0.06);
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .icon-box svg {
        width: 46px;
        height: 46px;
      }

      .badge {
        display: inline-block;
        padding: 8px 14px;
        border-radius: 999px;
        background: var(--soft);
        color: var(--accent);
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.5px;
        margin-bottom: 12px;
      }

      h1 {
        margin: 0;
        font-size: 30px;
        line-height: 1.2;
        color: var(--accent);
        letter-spacing: 0.5px;
      }

      .content {
        padding: 22px 24px 28px;
      }

      .code-label {
        font-size: 13px;
        color: var(--muted);
        letter-spacing: 1.5px;
        text-transform: uppercase;
        text-align: center;
        margin-bottom: 10px;
      }

      .code-box {
        background: #f8fafc;
        border: 1px solid var(--border);
        border-radius: 18px;
        padding: 18px 16px;
        text-align: center;
        margin-bottom: 20px;
      }

      .code-value {
        font-size: 34px;
        line-height: 1.1;
        font-weight: 800;
        color: #111827;
        letter-spacing: 2px;
        word-break: break-word;
      }

      .message {
        font-size: 18px;
        line-height: 1.75;
        color: #374151;
        text-align: center;
        margin: 0 0 24px 0;
      }

      .form {
        margin-top: 8px;
      }

      .btn {
        width: 100%;
        border: none;
        border-radius: 16px;
        padding: 18px 20px;
        background: var(--accent);
        color: #ffffff;
        font-size: 22px;
        font-weight: 800;
        letter-spacing: 1px;
        cursor: pointer;
        box-shadow: 0 10px 24px rgba(0,0,0,0.10);
        transition: transform 0.15s ease, opacity 0.15s ease;
      }

      .btn:active {
        transform: scale(0.98);
      }

      .hint {
        margin-top: 14px;
        font-size: 14px;
        line-height: 1.6;
        color: var(--muted);
        text-align: center;
      }

      .footer {
        padding: 16px 24px 24px;
        text-align: center;
        font-size: 12px;
        color: #9ca3af;
      }

      @media (max-width: 480px) {
        body {
          padding: 16px;
        }

        .top {
          padding: 24px 20px 16px;
        }

        .content {
          padding: 20px 18px 24px;
        }

        h1 {
          font-size: 28px;
        }

        .code-value {
          font-size: 30px;
        }

        .message {
          font-size: 17px;
        }

        .btn {
          font-size: 21px;
          padding: 17px 18px;
        }
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <div class="top">
          <div class="icon-box">
            ${theme.icon}
          </div>
          <div class="badge">${theme.badge}</div>
          <h1>${title}</h1>
        </div>

        <div class="content">
          <div class="code-label">優惠碼</div>
          <div class="code-box">
            <div class="code-value">${code}</div>
          </div>

          <p class="message">${message}</p>

          ${
            showButton
              ? `
            <form class="form" method="POST">
              <input type="hidden" name="code" value="${code}" />
              <button class="btn" type="submit">${theme.buttonText}</button>
            </form>
            <div class="hint">請確認顧客已完成消費，再由門市人員按下核銷。</div>
          `
              : ''
          }
        </div>

        <div class="footer">寶芝林門市核銷系統</div>
      </div>
    </div>
  </body>
  </html>
  `;
}

export default async function handler(req, res) {
  const code = req.method === 'POST' ? req.body.code : req.query.code;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  if (!code) {
    return res.status(200).send(
      renderPage({
        status: 'error',
        title: '缺少優惠碼',
        message: '請確認連結是否正確。',
        code: 'UNKNOWN',
        showButton: false,
      })
    );
  }

  try {
    await doc.loadInfo();
    const sheet = doc.sheetsByTitle['user_log'];
    const rows = await sheet.getRows();

    const row = rows.find((r) => r.get('coupon_code') === code);

    if (!row) {
      return res.status(200).send(
        renderPage({
          status: 'error',
          title: '查無此優惠碼',
          message: '請確認序號是否正確，或洽詢管理人員。',
          code,
          showButton: false,
        })
      );
    }

    const isUsed = row.get('is_redeemed') === 'YES';

    // GET：只顯示確認頁，不直接核銷
    if (req.method === 'GET') {
      if (isUsed) {
        return res.status(200).send(
          renderPage({
            status: 'error',
            title: '此券已核銷',
            message: `此優惠碼已完成核銷。\n核銷時間：${row.get('redeemed_at') || '時間不詳'}`,
            code,
            showButton: false,
          })
        );
      }

      return res.status(200).send(
        renderPage({
          status: 'confirm',
          title: '確認核銷',
          message: '請由門市人員確認顧客條件無誤後，再按下方按鈕完成核銷。',
          code,
          showButton: true,
        })
      );
    }

    // POST：按下按鈕才真正核銷
    if (req.method === 'POST') {
      if (isUsed) {
        return res.status(200).send(
          renderPage({
            status: 'error',
            title: '此券已核銷',
            message: `此優惠碼已完成核銷。\n核銷時間：${row.get('redeemed_at') || '時間不詳'}`,
            code,
            showButton: false,
          })
        );
      }

      row.set('is_redeemed', 'YES');
      row.set('redeemed_at', nowTaipei());
      await row.save();

      return res.status(200).send(
        renderPage({
          status: 'success',
          title: '核銷成功',
          message: '此優惠碼已完成核銷，請依門市流程提供顧客優惠。',
          code,
          showButton: false,
        })
      );
    }

    return res.status(200).send(
      renderPage({
        status: 'error',
        title: '不支援的操作',
        message: '請重新操作一次。',
        code,
        showButton: false,
      })
    );
  } catch (err) {
    console.error('Redeem API Error:', err);
    return res.status(500).send(
      renderPage({
        status: 'error',
        title: '系統錯誤',
        message: '系統忙碌中，請稍後再試。',
        code: code || 'UNKNOWN',
        showButton: false,
      })
    );
  }
}
