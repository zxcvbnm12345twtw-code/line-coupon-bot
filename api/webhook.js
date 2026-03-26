const { Client } = require('@line/bot-sdk');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

// 1. 配置
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

const storeConfig = {
  'B011': { name: '泰山明志店', audienceId: '4010389253318' },
  'B013': { name: '淡水中正店', audienceId: '3692460220204' },
  'B014': { name: '板橋北門店', audienceId: '7710570789694' },
  'B015': { name: '鶯歌國慶店', audienceId: '3748249875490' },
  'B016': { name: '深坑老街店', audienceId: '5311517315589' }
};

// --- 安全版精緻票券生成器 ---
const createFlexTicket = (storeName, couponCode, host, isUsed = false, redeemedTime = '') => {
  const mainColor = isUsed ? "#BDBDBD" : "#A68966";
  const bgColor = "#FAF9F6";
  
  return {
    type: "bubble",
    size: "md",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: bgColor,
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
      backgroundColor: bgColor,
      contents: [
        { type: "separator", color: "#E0E0E0" },
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
      backgroundColor: bgColor,
      contents: [
        isUsed ? {
          type: "text",
          text: "感謝您的光臨",
          align: "center",
          color: "#BDBDBD",
          size: "sm"
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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
  try {
    const events = req.body.events;
    await Promise.all(events.map(event => handleEvent(event, req)));
    return res.status(200).send('OK');
  } catch (err) {
    console.error('Webhook總錯誤:', err);
    return res.status(500).send('Error');
  }
}

async function handleEvent(event, req) {
  const userId = event.source.userId;
  const host = req.headers.host || 'line-coupon-bot.vercel.app'; // 強制給予預設值

  // 1. 處理加入好友
  if (event.type === 'follow') {
    return client.replyMessage(event.replyToken, {
      type: 'flex',
      altText: '歡迎加入！請選擇門市',
      contents: {
        type: "bubble",
        body: {
          type: "box",
          layout: "vertical",
          backgroundColor: "#FAF9F6",
          contents: [
            { type: "text", text: "WELCOME", weight: "bold", color: "#A68966", size: "sm" },
            { type: "text", text: "人文關懷．溫暖服務", weight: "bold", size: "lg", margin: "md" },
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
                action: { type: "message", label: storeConfig[id].name, text: id }
              }))
            }
          ]
        }
      }
    });
  }

  // 2. 處理店號訊息
  if (event.type === 'message' && event.message.type === 'text') {
    const storeId = event.message.text.trim().toUpperCase();
    if (!storeConfig[storeId]) return;

    // A. 抓取暱稱與 Audience API (放在一個 try 防止它失敗影響發券)
    let userName = '訪客';
    try {
      const profile = await client.getProfile(userId);
      userName = profile.displayName;
      
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
    } catch (e) { console.error('背景作業錯誤:', e); }

    // B. Google Sheet 操作
    await doc.loadInfo();
    const logSheet = doc.sheetsByTitle['user_log'];
    const couponSheet = doc.sheetsByTitle['coupon_pool'];
    const logRows = await logSheet.getRows();
    const hasClaimed = logRows.find(row => row.get('user_id') === userId);

    // C. 判斷與回覆
    try {
      if (hasClaimed) {
        const oldCode = hasClaimed.get('coupon_code');
        const isUsed = hasClaimed.get('is_redeemed') === 'YES';
        const oldStoreId = hasClaimed.get('store_id');
        const oldStoreName = storeConfig[oldStoreId] ? storeConfig[oldStoreId].name : '門市';
        const rTime = hasClaimed.get('redeemed_at') || '時間不詳';

        return await client.replyMessage(event.replyToken, {
          type: "flex",
          altText: "查看優惠券狀態",
          contents: createFlexTicket(oldStoreName, oldCode, host, isUsed, rTime)
        });
      }

      // 新領券
      const couponRows = await couponSheet.getRows();
      const availableCoupon = couponRows.find(row => row.get('status') === 'unused');
      if (!availableCoupon) {
        return client.replyMessage(event.replyToken, { type: 'text', text: '票券已領完' });
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

      return await client.replyMessage(event.replyToken, {
        type: "flex",
        altText: "您的優惠券已送達",
        contents: createFlexTicket(storeConfig[storeId].name, couponCode, host, false)
      });
      
    } catch (msgErr) {
      console.error('發送Flex訊息失敗:', msgErr);
      // 如果 Flex 失敗，保險起見發一個純文字作為備援
      return client.replyMessage(event.replyToken, { type: 'text', text: `登記成功！您的折扣碼為 ${couponCode}` });
    }
  }
}
