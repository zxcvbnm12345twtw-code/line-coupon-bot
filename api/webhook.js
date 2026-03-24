const { Client } = require('@line/bot-sdk');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

// 1. LINE 認證配置
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const client = new Client(config);

// 2. Google Sheets 認證配置
const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);

// 3. Webhook 主入口
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  try {
    const events = req.body.events;
    // 處理所有傳入的 LINE 事件
    await Promise.all(events.map(event => handleEvent(event)));
    return res.status(200).send('OK');
  } catch (err) {
    console.error('Error occurred:', err);
    return res.status(500).send('Internal Server Error');
  }
}

// 4. 事件處理邏輯
async function handleEvent(event) {
  const userId = event.source.userId;

  // --- 處理：加入好友 (Follow Event) ---
  if (event.type === 'follow') {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '歡迎加入！請選擇您目前的所在門市領取優惠券：',
      quickReply: {
        items: [
          { type: 'action', action: { type: 'message', label: '泰山明志', text: 'B011' } },
          { type: 'action', action: { type: 'message', label: '淡水中正', text: 'B013' } },
          { type: 'action', action: { type: 'message', label: '板橋北門', text: 'B014' } },
          { type: 'action', action: { type: 'message', label: '鶯歌國慶', text: 'B015' } },
          { type: 'action', action: { type: 'message', label: '深坑老街', text: 'B016' } }
        ]
      }
    });
  }

  // --- 處理：文字訊息 (Message Event) ---
  if (event.type === 'message' && event.message.type === 'text') {
    const storeId = event.message.text.trim().toUpperCase();
    const validStores = ['B011', 'B013', 'B014', 'B015', 'B016'];

    // 如果輸入的不是門市代碼，則不執行後續動作
    if (!validStores.includes(storeId)) return;

    // A. 嘗試抓取 LINE 用戶暱稱
    let userName = '未知用戶';
    try {
      const profile = await client.getProfile(userId);
      userName = profile.displayName;
    } catch (e) {
      console.error('Fetch Profile Error:', e);
    }

    // B. 連接 Google Sheets
    await doc.loadInfo();
    const logSheet = doc.sheetsByTitle['user_log'];
    const couponSheet = doc.sheetsByTitle['coupon_pool'];

    // C. 檢查防重複領取 (根據 user_id)
    const logRows = await logSheet.getRows();
    const hasClaimed = logRows.find(row => row.get('user_id') === userId);
    
    if (hasClaimed) {
      const oldCode = hasClaimed.get('coupon_code');
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: `您已領取過囉！\n您的專屬折扣碼是：${oldCode}\n\n請出示給門市人員核銷。`
      });
    }

    // D. 從 Pool 抓取一組未使用的折扣碼
    const couponRows = await couponSheet.getRows();
    const availableCoupon = couponRows.find(row => row.get('status') === 'unused');

    if (!availableCoupon) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '抱歉，目前的優惠券已全數領完，請洽現場人員。'
      });
    }

    const couponCode = availableCoupon.get('code');

    // E. 更新 coupon_pool 狀態
    availableCoupon.set('status', 'assigned');
    availableCoupon.set('user_id', userId);
    availableCoupon.set('assigned_at', new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }));
    await availableCoupon.save();

    // F. 寫入 user_log (包含抓到的名字)
    await logSheet.addRow({
      user_id: userId,
      user_name: userName,
      store_id: storeId,
      coupon_code: couponCode,
      timestamp: new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })
    });

    // G. 回傳成功訊息給用戶
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: `已為您登記門市 ${storeId}\n您的專屬優惠碼為：${couponCode}\n\n請出示給門市人員進行核銷。`
    });
  }
}
