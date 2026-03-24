const { Client } = require('@line/bot-sdk');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

// 1. LINE 配置
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const client = new Client(config);

// 2. Google Sheets 配置
const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);

// 3. Webhook 主處理器
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    const events = req.body.events;
    await Promise.all(events.map(event => handleEvent(event, req))); // 傳入 req 以取得網址域名
    return res.status(200).send('OK');
  } catch (err) {
    console.error('Webhook Handler Error:', err);
    return res.status(500).send('Internal Server Error');
  }
}

async function handleEvent(event, req) {
  const userId = event.source.userId;

  // --- 加入好友事件 (Follow) ---
  if (event.type === 'follow') {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '歡迎加入！請點擊下方按鈕，選擇您目前的所在門市領取優惠券：',
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

  // --- 文字訊息事件 (Message) ---
  if (event.type === 'message' && event.message.type === 'text') {
    const storeId = event.message.text.trim().toUpperCase();
    const validStores = ['B011', 'B013', 'B014', 'B015', 'B016'];

    if (!validStores.includes(storeId)) return;

    // A. 抓取用戶暱稱
    let userName = '未知用戶';
    try {
      const profile = await client.getProfile(userId);
      userName = profile.displayName;
    } catch (e) { console.error('Profile Error:', e); }

    await doc.loadInfo();
    const logSheet = doc.sheetsByTitle['user_log'];
    const couponSheet = doc.sheetsByTitle['coupon_pool'];

    // B. 檢查是否領過
    const logRows = await logSheet.getRows();
    const hasClaimed = logRows.find(row => row.get('user_id') === userId);
    
    // 取得當前網址域名，用於生成核銷連結
    const host = req.headers.host;

    if (hasClaimed) {
      const oldCode = hasClaimed.get('coupon_code');
      const isUsed = hasClaimed.get('is_redeemed') === 'YES';
      
      let msg = `您已領取過囉！\n您的折扣碼：${oldCode}`;
      if (isUsed) {
        msg += `\n(此券已於 ${hasClaimed.get('redeemed_at')} 核銷完畢)`;
      } else {
        msg += `\n\n⚠️ 店員核銷專用連結：\nhttps://${host}/api/redeem?code=${oldCode}`;
      }

      return client.replyMessage(event.replyToken, { type: 'text', text: msg });
    }

    // C. 發放新序號
    const couponRows = await couponSheet.getRows();
    const availableCoupon = couponRows.find(row => row.get('status') === 'unused');

    if (!availableCoupon) {
      return client.replyMessage(event.replyToken, { type: 'text', text: '抱歉，目前的優惠券已全數領完。' });
    }

    const couponCode = availableCoupon.get('code');

    // D. 更新 Pool
    availableCoupon.set('status', 'assigned');
    availableCoupon.set('user_id', userId);
    availableCoupon.set('assigned_at', new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }));
    await availableCoupon.save();

    // E. 寫入 Log
    await logSheet.addRow({
      user_id: userId,
      user_name: userName,
      store_id: storeId,
      coupon_code: couponCode,
      timestamp: new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }),
      is_redeemed: 'NO' // 初始化核銷狀態為 NO
    });

    // F. 回傳結果與核銷連結
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: `已為您登記門市 ${storeId}\n您的專屬優惠碼為：${couponCode}\n\n請出示給門市人員進行核銷。\n\n⚠️ 店員核銷專用連結：\nhttps://${host}/api/redeem?code=${couponCode}`
    });
  }
}
