// Vucar demo — read-only "live mirror" proxy.
// Maps a phone number -> a lead's real Zalo conversation + real agent thinking,
// so the static demo (vucar-ai-sales-demo.html, step "Trải nghiệm thử") can render
// the runtime live. READ-ONLY: it only SELECTs via the Metabase query API.
//
// Deploy on Vercel (this file = /api/lead) or adapt the handler for Cloudflare Workers.
// Required env vars:
//   METABASE_URL       e.g. https://metabase.vucar.internal
//   METABASE_API_KEY   a Metabase API key for a read-only account
//   ALLOW_ORIGIN       e.g. https://minhthunguyen-sys.github.io  (or *)
//   DB_CRM (=2)  DB_E2E (=9)  DB_ZALO (=11)   [optional overrides]
//
// Then in vucar-ai-sales-demo.html set:  const PROXY_URL = 'https://<your-deploy>/api/lead';

const MB   = process.env.METABASE_URL;
const KEY  = process.env.METABASE_API_KEY;
const ORIGIN = process.env.ALLOW_ORIGIN || '*';
const DB_CRM  = +(process.env.DB_CRM  || 2);
const DB_E2E  = +(process.env.DB_E2E  || 9);
const DB_ZALO = +(process.env.DB_ZALO || 11);

// friendly labels for the thinking column
const TOOL_LABEL = {
  recall_skills:'Nạp kỹ năng', read_image:'Đọc ảnh (OCR)', send_evidence:'Gửi bằng chứng giá',
  review_message:'Guardrail kiểm duyệt', send_zalo_message:'Gửi Zalo', book_inspection:'Đặt lịch kiểm định',
  request_dealer_bids:'Đẩy dealer đấu giá', compute_unified_deal_signals:'Tính tín hiệu deal',
  get_price_analysis:'Phân tích giá', predict_price_vap:'Định giá VAP', update_session:'Cập nhật phiên',
  update_chat_summary:'Cập nhật tóm tắt', log_action:'Ghi nhận hành động', schedule_followup:'Lên lịch nhắc',
  notify_pic:'Chuyển người phụ trách', fetch_lead_context:'Đọc bối cảnh lead', read_session_state:'Đọc trạng thái phiên'
};

async function mb(database, query) {
  const r = await fetch(`${MB}/api/dataset`, {
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'x-api-key':KEY },
    body: JSON.stringify({ database, type:'native', native:{ query } })
  });
  if (!r.ok) throw new Error(`metabase ${r.status}`);
  const j = await r.json();
  const cols = (j.data.cols || []).map(c => c.name);
  return (j.data.rows || []).map(row => Object.fromEntries(row.map((v,i)=>[cols[i], v])));
}

const clean = s => String(s||'').replace(/<\/?think>/g,'').replace(/\s+/g,' ').trim().slice(0,240);
const isPhoto = t => /^\[?\s*(hình ảnh|ảnh|image|photo)/i.test(String(t||''));

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const phone = String((req.query && req.query.phone) || '').replace(/\D/g,'');
  if (!/^\d{8,12}$/.test(phone)) return res.status(400).json({ found:false, error:'bad phone' });

  try {
    // 1) Zalo thread + name
    const rel = await mb(DB_ZALO,
      `SELECT friend_id, lead_name FROM leads_relation WHERE phone='${phone}' ORDER BY updated_at DESC NULLS LAST LIMIT 1`);
    if (!rel.length) return res.status(200).json({ found:false });
    const friendId = rel[0].friend_id;
    const name = rel[0].lead_name || 'Khách hàng';

    // 2) car_id + car label (CRM)
    const car = await mb(DB_CRM,
      `SELECT c.id AS car_id,
              COALESCE(NULLIF(c.display_name,''), concat_ws(' ', c.brand, c.model, c.variant, c.year)) AS car
       FROM leads l JOIN cars c ON c.lead_id=l.id
       WHERE l.phone='${phone}' AND COALESCE(c.is_deleted,false)=false
       ORDER BY c.created_at DESC NULLS LAST LIMIT 1`);
    const carId = car.length ? car[0].car_id : null;
    const carLabel = car.length ? car[0].car : '';

    // 3) Zalo messages (both sides)
    const msgs = await mb(DB_ZALO,
      `SELECT is_self, content, created_at FROM messages
       WHERE thread_id='${friendId}' AND content NOT LIKE '{%'
         AND created_at > now() - interval '2 days'
       ORDER BY created_at ASC LIMIT 60`);

    // 4) agent thinking (latest runs for this car)
    let logs = [];
    if (carId) logs = await mb(DB_E2E,
      `SELECT l.log_type, l.tool_name, l.content, l.created_at
       FROM agent_pipeline_logs l JOIN agent_pipeline_runs r ON r.id=l.run_id
       WHERE r.car_id='${carId}' AND r.created_at > now() - interval '2 days'
       ORDER BY l.created_at ASC LIMIT 200`);

    // ---- map into a single time-sorted feed ----
    const feed = [];
    for (const m of msgs) feed.push({
      ts: m.created_at, col:'chat',
      from: m.is_self ? 'agent' : 'cust',
      text: clean(m.content), photo: isPhoto(m.content) ? 1 : undefined
    });

    for (const g of logs) {
      const t = g.tool_name, ty = g.log_type, c = g.content || '';
      if (ty === 'text') {
        const x = clean(c); if (x) feed.push({ ts:g.created_at, col:'think', kind:'think', lab:'Suy nghĩ', x });
      } else if (ty === 'tool_result' && t === 'send_zalo_message' && /"blocked"/.test(c)) {
        feed.push({ ts:g.created_at, col:'think', kind:'guard', lab:'Guardrail CHẶN', tool:'price_quote_guard',
          x:'⛔ Tin bị chặn trước khi gửi — vi phạm quy tắc giá/nội dung. Agent phải viết lại.', chip:'block' });
      } else if (ty === 'tool_call') {
        const item = { ts:g.created_at, col:'think', kind:'tool', lab: TOOL_LABEL[t] || t, tool:t, x:'' };
        if (t === 'send_zalo_message') { item.x = 'Soạn & gửi tin nhắn cho khách.'; item.chip = 'ok'; }
        else if (t === 'read_image') item.x = 'Đọc ảnh khách gửi (giấy tờ / xe).';
        else item.x = `Gọi công cụ ${t}.`;
        feed.push(item);
      }
    }
    feed.sort((a,b)=> new Date(a.ts) - new Date(b.ts));
    feed.forEach(f => delete f.ts);

    return res.status(200).json({
      found:true, name, car:carLabel, avatar:(name.trim()[0]||'K').toUpperCase(), feed
    });
  } catch (e) {
    return res.status(500).json({ found:false, error:String(e.message||e) });
  }
}
