const { Client } = require('@line/bot-sdk');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

// 1. 配置 (由環境變數讀取)
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const client = new Client(config);

const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);

// --- 門市與 LINE 受眾 ID 對應表 (已填入你提供的 ID) ---
const audienceMap = {
  'B011': '4010389253318', // 泰山門市
  'B013': '3692460220204', // 淡水門市
  'B014': '7710570789694', // 板橋門市
  'B015': '3748249875490', // 鶯歌門市
  'B016': '5311517315589'  // 深坑門市
};

// 2. Webhook 入口
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
  try {
    const events = req.body.events;
    await Promise.all(events.map(event => handleEvent(event, req)));
    return res.status(200).send('OK');
  } catch (err) {
    console.error('Webhook Error:', err);
    return res.status(500).send('Internal Server Error');
  }
}

async function handleEvent(event, req) {
  const userId = event.source.userId;

  // --- 處理：加入好友/封鎖重加 (Follow) ---
  if (event.type === 'follow') {
    return client.replyMessage(event.replyToken, {
      type: 'flex',
      altText: '歡迎加入！請選擇門市領取優惠券',
      contents: {
        type: "bubble",
        hero: {
          type: "image",
          url: "https://images.unsplash.com/photo-1556740734-7f95837965bb?q=80&w=1000&auto=format&fit=crop",
          size: "full",
          aspectRatio: "20:13",
          aspectMode: "cover"
        },
        body: {
          type: "box",
          layout: "vertical",
          spacing: "md",
          contents: [
            { type: "text", text: "WELCOME", weight: "bold", color: "#1DB446", size: "sm" },
            { type: "text", text: "請選擇您的所在門市", weight: "bold", size: "xl", margin: "md" },
            { type: "text", text: "點擊下方按鈕即可領取店鋪專屬折扣碼", size: "xs", color: "#aaaaaa", wrap: true }
          ]
        },
        footer: {
          type: "box",
          layout: "vertical",
          spacing: "sm",
          contents: [
            { type: "button", style: "primary", color: "#1DB446", action: { type: "message", label: "泰山明志店", text: "B011" } },
            { type: "button", style: "primary", color: "#1DB446", action: { type: "message", label: "淡水中正店", text: "B013" } },
            { type: "button", style: "primary", color: "#1DB446", action: { type: "message", label: "板橋北門店", text: "B014" } },
            { type: "button", style: "primary", color: "#1DB446", action: { type: "message", label: "鶯歌國慶店", text: "B015" } },
            { type: "button", style: "primary", color: "#1DB446", action: { type: "message", label: "深坑老街店", text: "B016" } }
          ]
        }
      }
    });
  }

  // --- 處理：文字訊息 (Message) ---
  if (event.type === 'message' && event.message.type === 'text') {
    const storeId = event.message.text.trim().toUpperCase();
    const validStores = Object.keys(audienceMap);

    // 如果不是門市代碼就結束
    if (!validStores.includes(storeId)) return;

    // A. 抓取暱稱
    let userName = '未知用戶';
    try {
      const profile = await client.getProfile(userId);
      userName = profile.displayName;
    } catch (e) { console.error('Fetch Profile Error:', e); }

    // B. 自動加入 LINE 受眾 (Audience API)
    try {
      const audienceId = audienceMap[storeId];
      await fetch('https://api.line.me/v2/bot/audienceGroup/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
        },
        body: JSON.stringify({
          audienceGroupId: Number(audienceId),
          audiences: [{ id: userId }]
        })
      });
    } catch (apiErr) { console.error('Audience API Error:', apiErr); }

    // C. Google Sheets 操作
    await doc.loadInfo();
    const logSheet = doc.sheetsByTitle['user_log'];
    const couponSheet = doc.sheetsByTitle['coupon_pool'];
    const logRows = await logSheet.getRows();
    const hasClaimed = logRows.find(row => row.get('user_id') === userId);
    const host = req.headers.host;

    // D. 判斷是否重複領取
    if (hasClaimed) {
      const oldCode = hasClaimed.get('coupon_code');
      const isUsed = hasClaimed.get('is_redeemed') === 'YES';
      
      let resText = `您已領取過囉！\n您的折扣碼：${oldCode}`;
      if (isUsed) {
        resText += `\n(此券已於 ${hasClaimed.get('redeemed_at')} 核銷完畢)`;
      } else {
        resText += `\n\n⚠️ 店員核銷專用連結：\nhttps://${host}/api/redeem?code=${oldCode}`;
      }
      return client.replyMessage(event.replyToken, { type: 'text', text: resText });
    }

    // E. 從 Pool 抓取序號
    const couponRows = await couponSheet.getRows();
    const availableCoupon = couponRows.find(row => row.get('status') === 'unused');

    if (!availableCoupon) {
      return client.replyMessage(event.replyToken, { type: 'text', text: '抱歉，目前的優惠券已全數領完。' });
    }

    const couponCode = availableCoupon.get('code');

    // F. 更新 Pool & 寫入 Log
    availableCoupon.set('status', 'assigned');
    availableCoupon.set('user_id', userId);
    availableCoupon.set('assigned_at', new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }));
    await availableCoupon.save();

    await logSheet.addRow({
      user_id: userId,
      user_name: userName,
      store_id: storeId,
      coupon_code: couponCode,
      timestamp: new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }),
      is_redeemed: 'NO'
    });

    // G. 回傳成功與核銷連結
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: `已為您登記門市 ${storeId}\n您的專屬優惠碼為：${couponCode}\n\n請出示給門市人員進行核銷。\n\n⚠️ 店員核銷專用連結：\nhttps://${host}/api/redeem?code=${couponCode}`
    });
  }
}
