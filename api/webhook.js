const { Client } = require('@line/bot-sdk');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

// 1. 基本配置
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

// --- 門市資料對照表 ---
const storeConfig = {
  'B011': { name: '泰山明志店', audienceId: '4010389253318' },
  'B013': { name: '淡水中正店', audienceId: '3692460220204' },
  'B014': { name: '板橋北門店', audienceId: '7710570789694' },
  'B015': { name: '鶯歌國慶店', audienceId: '3748249875490' },
  'B016': { name: '深坑老街店', audienceId: '5311517315589' }
};

// --- 設計方案：人文感精緻票券 (Flex Message) ---
const createFlexTicket = (storeName, couponCode, host, isUsed = false, redeemedTime = '') => {
  const mainColor = isUsed ? "#BDBDBD" : "#A68966"; // 已使用為灰色，未使用為暖木棕
  const subColor = isUsed ? "#EEEEEE" : "#FAF9F6";
  
  return {
    type: "bubble",
    size: "md",
    styles: {
      header: { backgroundColor: subColor },
      body: { backgroundColor: subColor },
      footer: { backgroundColor: subColor }
    },
    header: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "text",
          text: isUsed ? "COUPON EXPIRED" : "OFFICIAL COUPON",
          size: "xxs",
          color: isUsed ? "#999999" : "#A68966",
          letterSpacing: "2px",
          align: "center",
          weight: "bold"
        },
        {
          type: "text",
          text: storeName,
          weight: "bold",
          color: "#444444",
          size: "lg",
          align: "center",
          margin: "md"
        }
      ]
    },
    body: {
      type: "box",
      layout: "vertical",
      contents: [
        { type: "separator", color: "#E0E0E0", margin: "md" },
        {
          type: "box",
          layout: "vertical",
          margin: "xxl",
          spacing: "sm",
          contents: [
            {
              type: "text",
              text: isUsed ? "此優惠券已使用" : "您的專屬折扣碼",
              size: "xs",
              color: isUsed ? "#999999" : "#A68966",
              align: "center"
            },
            {
              type: "text",
              text: couponCode,
              size: "xxl",
              color: isUsed ? "#999999" : "#333333",
              weight: "bold",
              align: "center",
              margin: "sm"
            }
          ]
        },
        {
          type: "box",
          layout: "vertical",
          margin: "xxl",
          contents: [
            {
              type: "text",
              text: "• • • • • • • • • • • • • • • • • • • •",
              color: "#D1D1D1",
              align: "center",
              size: "xs"
            }
          ]
        },
        {
          type: "text",
          text: isUsed ? `核銷時間：${redeemedTime}` : "使用時請向店員出示此頁面",
          size: "xs",
          color: "#BCBCBC",
          align: "center",
          margin: "md",
          wrap: true
        }
      ]
    },
    footer: {
      type: "box",
      layout: "vertical",
      contents: [
        isUsed ? {
          type: "text",
          text: "感謝您的光臨",
          align: "center",
          color: "#BDBDBD",
          size: "sm",
          margin: "sm"
        } : {
          type: "button",
          action: {
            type: "uri",
            label: "店員點擊核銷",
            uri: `https://${host}/api/redeem?code=${couponCode}`
          },
          style: "primary",
          color: mainColor,
          height: "sm"
        }
      ]
    }
  };
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
    return res.status(500).send('Internal Error');
  }
}

async function handleEvent(event, req) {
  const userId = event.source.userId;
  const host = req.headers.host;

  // --- 處理：加入好友/選單 (Follow) ---
  if (event.type === 'follow') {
    return client.replyMessage(event.replyToken, {
      type: 'flex',
      altText: '歡迎加入！請選擇門市領取優惠券',
      contents: {
        type: "bubble",
        styles: { body: { backgroundColor: "#FAF9F6" } },
        body: {
          type: "box",
          layout: "vertical",
          spacing: "md",
          contents: [
            { type: "text", text: "WELCOME", weight: "bold", color: "#A68966", size: "sm", letterSpacing: "2px" },
            { type: "text", text: "人文關懷．溫暖服務", weight: "bold", size: "lg", color: "#444444" },
            { type: "text", text: "請選擇您所在的門市，領取今日的專屬優惠券。", size: "sm", color: "#888888", wrap: true },
            { type: "separator", margin: "lg" },
            {
              type: "box",
              layout: "vertical",
              spacing: "sm",
              margin: "lg",
              contents: Object.keys(storeConfig).map(id => ({
                type: "button",
                style: "secondary",
                color: "#A68966",
                height: "sm",
                action: { type: "message", label: storeConfig[id].name, text: id }
              }))
            }
          ]
        }
      }
    });
  }

  // --- 處理：文字訊息 (Message) ---
  if (event.type === 'message' && event.message.type === 'text') {
    const storeId = event.message.text.trim().toUpperCase();
    if (!storeConfig[storeId]) return;

    let userName = '訪客';
    try {
      const profile = await client.getProfile(userId);
      userName = profile.displayName;
    } catch (e) { console.error('Profile Error:', e); }

    // 自動加入受眾
    try {
      const audienceId = storeConfig[storeId].audienceId;
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
    } catch (apiErr) { console.error('Audience API Error'); }

    await doc.loadInfo();
    const logSheet = doc.sheetsByTitle['user_log'];
    const couponSheet = doc.sheetsByTitle['coupon_pool'];
    const logRows = await logSheet.getRows();
    const hasClaimed = logRows.find(row => row.get('user_id') === userId);

    const storeName = storeConfig[storeId].name;

    // A. 判斷重複領取
    if (hasClaimed) {
      const oldCode = hasClaimed.get('coupon_code');
      const isUsed = hasClaimed.get('is_redeemed') === 'YES';
      const oldStoreName = storeConfig[hasClaimed.get('store_id')] ? storeConfig[hasClaimed.get('store_id')].name : '門市';
      const rTime = hasClaimed.get('redeemed_at') || '';

      return client.replyMessage(event.replyToken, {
        type: "flex",
        altText: "查詢優惠券狀態",
        contents: createFlexTicket(oldStoreName, oldCode, host, isUsed, rTime)
      });
    }

    // B. 新領券邏輯
    const couponRows = await couponSheet.getRows();
    const availableCoupon = couponRows.find(row => row.get('status') === 'unused');

    if (!availableCoupon) {
      return client.replyMessage(event.replyToken, { type: 'text', text: '今日票券已領完，期待下次與您見面。' });
    }

    const couponCode = availableCoupon.get('code');
    availableCoupon.set('status', 'assigned');
    availableCoupon.set('user_id', userId);
    availableCoupon.set('assigned_at', new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }));
    await availableCoupon.save();

    await logSheet.addRow({
      user_id: userId, user_name: userName, store_id: storeId, coupon_code: couponCode,
      timestamp: new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }),
      is_redeemed: 'NO', redeemed_at: ''
    });

    return client.replyMessage(event.replyToken, {
      type: "flex",
      altText: "您的專屬優惠券已送達",
      contents: createFlexTicket(storeName, couponCode, host, false)
    });
  }
}
