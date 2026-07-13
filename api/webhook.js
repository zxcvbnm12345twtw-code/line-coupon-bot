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

const doc = new GoogleSpreadsheet(
  process.env.GOOGLE_SHEET_ID,
  serviceAccountAuth
);

// ============================================================
// 活動時間設定
// 2026/09/01 00:00 起停止發放新優惠碼（台灣時間 UTC+8）
// ============================================================
const CAMPAIGN_END_AT = new Date('2026-09-01T00:00:00+08:00');

function isCampaignActive() {
  return Date.now() < CAMPAIGN_END_AT.getTime();
}

const campaignEndedMessage =
  '🌿 感謝您的支持！\n\n' +
  '「加入官方 LINE 領取 100 元折價券」活動已於 2026 年 8 月 31 日圓滿結束。\n\n' +
  '後續新品與門市活動資訊，仍會透過官方 LINE 與您分享。';

// --- 門市資料對照表 ---
const storeConfig = {
  B011: {
    name: '泰山明志店',
    audienceId: '4010389253318',
  },
  B013: {
    name: '淡水中正店',
    audienceId: '3692460220204',
  },
  B014: {
    name: '板橋北門店',
    audienceId: '7710570789694',
  },
  B015: {
    name: '鶯歌國慶店',
    audienceId: '3748249875490',
  },
  B016: {
    name: '深坑老街店',
    audienceId: '5311517315589',
  },
};

// 2. Webhook 入口
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  try {
    const events = Array.isArray(req.body?.events)
      ? req.body.events
      : [];

    await Promise.all(
      events.map((event) => handleEvent(event, req))
    );

    return res.status(200).send('OK');
  } catch (err) {
    console.error('Webhook Error:', err);
    return res.status(500).send('Internal Error');
  }
}

async function handleEvent(event, req) {
  const userId = event?.source?.userId;
  const host = req.headers.host;

  if (!userId) {
    return;
  }

  // ==========================================================
  // 加入好友／封鎖後重新加入
  // ==========================================================
  if (event.type === 'follow') {
    // 活動結束後，不再顯示門市選擇及領券按鈕
    if (!isCampaignActive()) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: campaignEndedMessage,
      });
    }

    return client.replyMessage(event.replyToken, {
      type: 'flex',
      altText: '歡迎加入！請選擇門市領取優惠券',
      contents: {
        type: 'bubble',
        hero: {
          type: 'image',
          url: 'https://cdn-next.cybassets.com/media/W1siZiIsIjMyODYwL2F0dGFjaGVkX3Bob3Rvcy8xNzc0NTEwNjE1Xzc3LmpwZy5qcGVnIl1d.jpeg?sha=2aededbc8c3b1a6a',
          size: 'full',
          aspectRatio: '20:13',
          aspectMode: 'cover',
        },
        body: {
          type: 'box',
          layout: 'vertical',
          spacing: 'md',
          contents: [
            {
              type: 'text',
              text: 'WELCOME',
              weight: 'bold',
              color: '#1DB446',
              size: 'sm',
            },
            {
              type: 'text',
              text: '請選擇您的所在門市',
              weight: 'bold',
              size: 'xl',
              margin: 'md',
            },
            {
              type: 'text',
              text: '點擊下方按鈕即可領取店鋪專屬折扣碼',
              size: 'xs',
              color: '#aaaaaa',
              wrap: true,
            },
          ],
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: Object.keys(storeConfig).map((id) => ({
            type: 'button',
            style: 'primary',
            color: '#1DB446',
            action: {
              type: 'message',
              label: storeConfig[id].name,
              text: id,
            },
          })),
        },
      },
    });
  }

  // ==========================================================
  // 文字訊息
  // ==========================================================
  if (
    event.type !== 'message' ||
    event.message?.type !== 'text'
  ) {
    return;
  }

  const storeId = event.message.text.trim().toUpperCase();

  // 不是有效門市代碼，維持目前設定：不回覆
  if (!storeConfig[storeId]) {
    return;
  }

  // 先讀取資料，確認這位使用者是否曾經領過券
  await doc.loadInfo();

  const logSheet = doc.sheetsByTitle['user_log'];
  const couponSheet = doc.sheetsByTitle['coupon_pool'];

  if (!logSheet || !couponSheet) {
    throw new Error('找不到 user_log 或 coupon_pool 工作表');
  }

  const logRows = await logSheet.getRows();

  const hasClaimed = logRows.find(
    (row) => row.get('user_id') === userId
  );

  // ==========================================================
  // 曾經領過券的人
  // 活動結束後仍可找回原優惠碼及查詢核銷狀態
  // ==========================================================
  if (hasClaimed) {
    const oldCode = hasClaimed.get('coupon_code');
    const isUsed =
      hasClaimed.get('is_redeemed') === 'YES';

    const claimedStoreId =
      hasClaimed.get('store_id');

    const redeemedTime =
      hasClaimed.get('redeemed_at') || '時間不詳';

    const storeName = storeConfig[claimedStoreId]
      ? storeConfig[claimedStoreId].name
      : claimedStoreId;

    let resText =
      `您已領取過囉！\n` +
      `您的折扣碼：${oldCode}`;

    if (isUsed) {
      resText +=
        `\n\n此券已於 ${redeemedTime}` +
        `\n在【${storeName}】核銷完畢。`;
    } else {
      resText +=
        `\n\n門市：${storeName}` +
        `\n\n⚠️ 此優惠碼僅適用於實體門市消費` +
        `\n線上官網商店恕不適用。` +
        `\n\n店員核銷專用連結：` +
        `\nhttps://${host}/api/redeem?code=${encodeURIComponent(oldCode)}`;
    }

    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: resText,
    });
  }

  // ==========================================================
  // 活動結束後
  // 尚未領過的人不再發券、不加入受眾、不新增資料
  // ==========================================================
  if (!isCampaignActive()) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: campaignEndedMessage,
    });
  }

  // ==========================================================
  // 以下僅在活動期間執行
  // ==========================================================

  // A. 抓取用戶暱稱
  let userName = '未知用戶';

  try {
    const profile = await client.getProfile(userId);
    userName = profile.displayName;
  } catch (e) {
    console.error('Profile Error:', e);
  }

  // B. 自動加入 LINE 門市受眾
  try {
    const audienceId =
      storeConfig[storeId].audienceId;

    const audienceResponse = await fetch(
      'https://api.line.me/v2/bot/audienceGroup/upload',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization:
            `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        },
        body: JSON.stringify({
          audienceGroupId: Number(audienceId),
          audiences: [{ id: userId }],
        }),
      }
    );

    if (!audienceResponse.ok) {
      const audienceError =
        await audienceResponse.text();

      console.error(
        'Audience API Error:',
        audienceResponse.status,
        audienceError
      );
    }
  } catch (apiErr) {
    console.error('Audience API Error:', apiErr);
  }

  // C. 領取新序號
  const couponRows = await couponSheet.getRows();

  const availableCoupon = couponRows.find(
    (row) => row.get('status') === 'unused'
  );

  if (!availableCoupon) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text:
        '抱歉，目前的優惠券已全數領完，' +
        '請洽現場人員。',
    });
  }

  const couponCode =
    availableCoupon.get('code');

  const assignedAt = new Date().toLocaleString(
    'zh-TW',
    {
      timeZone: 'Asia/Taipei',
    }
  );

  // D. 更新 coupon_pool
  availableCoupon.set('status', 'assigned');
  availableCoupon.set('user_id', userId);
  availableCoupon.set('assigned_at', assignedAt);

  await availableCoupon.save();

  // E. 寫入 user_log
  await logSheet.addRow({
    user_id: userId,
    user_name: userName,
    store_id: storeId,
    coupon_code: couponCode,
    timestamp: assignedAt,
    is_redeemed: 'NO',
    redeemed_at: '',
  });

  // F. 回傳領券成功訊息
  return client.replyMessage(event.replyToken, {
    type: 'text',
    text:
      `已為您登記門市 ${storeConfig[storeId].name}\n` +
      `您的專屬優惠碼為：${couponCode}\n\n` +
      `請出示給門市人員進行核銷。\n\n` +
      `⚠️ 此優惠碼僅適用於實體門市消費\n` +
      `線上官網商店恕不適用。\n\n` +
      `店員核銷專用連結：\n` +
      `https://${host}/api/redeem?code=${encodeURIComponent(couponCode)}`,
  });
}
