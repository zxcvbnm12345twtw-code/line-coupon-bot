const { Client } = require('@line/bot-sdk');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const client = new Client(config);

const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'), // 自動處理換行
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    const events = req.body.events;
    await Promise.all(events.map(event => handleEvent(event)));
    return res.status(200).send('OK');
  } catch (err) {
    console.error('Error:', err);
    return res.status(500).send('Internal Server Error');
  }
}

async function handleEvent(event) {
  const userId = event.source.userId;

  // 1. 加入好友 (Follow)
  if (event.type === 'follow') {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '歡迎加入！請點擊下方按鈕選擇您目前的所在門市：',
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

  // 2. 接收門市代碼訊息 (Message)
  if (event.type === 'message' && event.message.type === 'text') {
    const storeId = event.message.text.trim().toUpperCase();
    const validStores = ['B011', 'B013', 'B014', 'B015', 'B016'];

    if (!validStores.includes(storeId)) return; // 沒打對代碼就不理他，或是你可以回傳提示

    await doc.loadInfo();
    const logSheet = doc.sheetsByTitle['user_log'];
    const couponSheet = doc.sheetsByTitle['coupon_pool'];

    // 檢查是否已領取
    const logRows = await logSheet.getRows();
    const hasClaimed = logRows.find(row => row.get('user_id') === userId);
    
    if (hasClaimed) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: `您已領取過囉！您的折扣碼是：${hasClaimed.get('coupon_code')}\n請出示給櫃姐核銷。`
      });
    }

    // 發放新折扣碼
    const couponRows = await couponSheet.getRows();
    const availableCoupon = couponRows.find(row => row.get('status') === 'unused');

    if (!availableCoupon) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '抱歉，今日折扣碼已領完！'
      });
    }

    const couponCode = availableCoupon.get('code');

    // 更新 Pool 狀態
    availableCoupon.set('status', 'assigned');
    availableCoupon.set('user_id', userId);
    availableCoupon.set('assigned_at', new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }));
    await availableCoupon.save();

    // 寫入 Log
    await logSheet.addRow({
      user_id: userId,
      store_id: storeId,
      coupon_code: couponCode,
      timestamp: new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })
    });

    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: `已為您登記門市 ${storeId}\n您的專屬優惠碼為：${couponCode}\n\n請出示給門市人員進行核銷。`
    });
  }
}
