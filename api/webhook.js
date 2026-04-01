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
  B011: { name: '泰山明志店', audienceId: '4010389253318' },
  B013: { name: '淡水中正店', audienceId: '3692460220204' },
  B014: { name: '板橋北門店', audienceId: '7710570789694' },
  B015: { name: '鶯歌國慶店', audienceId: '3748249875490' },
  B016: { name: '深坑老街店', audienceId: '5311517315589' },
};

function nowTaipei() {
  return new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
}

function isRedeemedValue(value) {
  if (value === undefined || value === null) return false;
  const v = String(value).trim().toUpperCase();
  return v === 'YES' || v === 'TRUE' || v === '1' || v === 'REDEEMED';
}

function normalizeStatus(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim().toLowerCase();
}

function safeGet(row, key) {
  try {
    return row.get(key);
  } catch (e) {
    return '';
  }
}

function safeSet(row, key, value) {
  try {
    row.set(key, value);
  } catch (e) {
    // 若欄位不存在則略過，避免整體報錯
  }
}

// 2. Webhook 入口
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  try {
    const events = req.body.events || [];
    await Promise.all(events.map((event) => handleEvent(event)));
    return res.status(200).send('OK');
  } catch (err) {
    console.error('Webhook Error:', err);
    return res.status(500).send('Internal Error');
  }
}

async function handleEvent(event) {
  const userId = event?.source?.userId;
  if (!userId) return;

  // --- 處理：加入好友 / 封鎖重加 ---
  if (event.type === 'follow') {
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
            { type: 'text', text: 'WELCOME', weight: 'bold', color: '#1DB446', size: 'sm' },
            { type: 'text', text: '請選擇您的所在門市', weight: 'bold', size: 'xl', margin: 'md' },
            { type: 'text', text: '點擊下方按鈕即可領取店鋪專屬優惠碼', size: 'xs', color: '#aaaaaa', wrap: true },
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

  // --- 處理：文字訊息 ---
  if (!(event.type === 'message' && event.message.type === 'text')) {
    return;
  }

  const storeId = event.message.text.trim().toUpperCase();

  // 非門市代碼不處理
  if (!storeConfig[storeId]) return;

  // A. 取用戶暱稱
  let userName = '未知用戶';
  try {
    const profile = await client.getProfile(userId);
    userName = profile.displayName;
  } catch (e) {
    console.error('Profile Error:', e);
  }

  // B. 加入 LINE 受眾（失敗不影響主流程）
  try {
    const audienceId = storeConfig[storeId].audienceId;
    await fetch('https://api.line.me/v2/bot/audienceGroup/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        audienceGroupId: Number(audienceId),
        audiences: [{ id: userId }],
      }),
    });
  } catch (apiErr) {
    console.error('Audience API Error:', apiErr);
  }

  // C. Google Sheets 操作
  await doc.loadInfo();
  const logSheet = doc.sheetsByTitle['user_log'];
  const couponSheet = doc.sheetsByTitle['coupon_pool'];

  if (!logSheet || !couponSheet) {
    console.error('Sheet not found: user_log or coupon_pool');
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '系統設定異常，請洽現場人員協助。',
    });
  }

  const logRows = await logSheet.getRows();

  // 檢查是否已領過
  const claimedRow = logRows.find((row) => safeGet(row, 'user_id') === userId);

  if (claimedRow) {
    const oldCode = safeGet(claimedRow, 'coupon_code');
    const claimedStoreId = safeGet(claimedRow, 'store_id');
    const redeemedAt = safeGet(claimedRow, 'redeemed_at') || '時間不詳';
    const redeemed = isRedeemedValue(safeGet(claimedRow, 'is_redeemed'));
    const claimedStoreName = storeConfig[claimedStoreId]?.name || claimedStoreId || '未知門市';

    let text = `您已領取過專屬優惠碼。\n您的優惠碼為：${oldCode}\n門市：${claimedStoreName}`;

    if (redeemed) {
      text += `\n\n此券已核銷\n核銷時間：${redeemedAt}`;
    } else {
      text += `\n\n請直接出示此優惠碼給門市人員核銷。`;
    }

    return client.replyMessage(event.replyToken, {
      type: 'text',
      text,
    });
  }

  // D. 領取新序號
  const couponRows = await couponSheet.getRows();
  const availableCoupon = couponRows.find((row) => normalizeStatus(safeGet(row, 'status')) === 'unused');

  if (!availableCoupon) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '抱歉，目前的優惠券已全數領完，請洽現場人員。',
    });
  }

  const couponCode =
    safeGet(availableCoupon, 'code') ||
    safeGet(availableCoupon, 'redeem_code') ||
    safeGet(availableCoupon, 'coupon_code');

  if (!couponCode) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '系統讀取優惠碼失敗，請洽現場人員協助。',
    });
  }

  // E. 更新 coupon_pool：只改成 assigned，不是 redeemed
  safeSet(availableCoupon, 'status', 'assigned');
  safeSet(availableCoupon, 'user_id', userId);
  safeSet(availableCoupon, 'assigned_at', nowTaipei());
  safeSet(availableCoupon, 'assigned_store', storeId);
  await availableCoupon.save();

  // F. 寫入 user_log：初始化為未核銷
  await logSheet.addRow({
    user_id: userId,
    user_name: userName,
    store_id: storeId,
    coupon_code: couponCode,
    timestamp: nowTaipei(),
    is_redeemed: 'NO',
    redeemed_at: '',
  });

  // G. 回傳領券成功訊息（不再提供核銷連結給顧客）
  return client.replyMessage(event.replyToken, {
    type: 'text',
    text:
      `已為您登記門市 ${storeConfig[storeId].name}\n` +
      `您的專屬優惠碼為：${couponCode}\n\n` +
      `請直接出示此優惠碼給門市人員進行核銷。\n` +
      `本券僅限本人使用。`,
  });
}
