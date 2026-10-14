'use strict';
/**
 * 宠物对话通道。
 *
 * 默认走 Pollinations 的免费 OpenAI 兼容接口（不需要 key）。
 * 想换成别的模型，只要它是 OpenAI 兼容协议，设三个环境变量即可：
 *   PET_AI_BASE=https://api.deepseek.com/v1  （填到 /v1 这一层）
 *   PET_AI_KEY=sk-xxxx
 *   PET_AI_MODEL=deepseek-chat
 * 也可用 PET_AI_OFFLINE=1 强制本地小脑袋模式。
 *
 * 远端不可用时自动退回本地小脑袋（不联网也能对话），所以页面永远有回应。
 */

const DEFAULT_BASE = 'https://text.pollinations.ai/openai';
const DEFAULT_MODEL = 'openai';
const REQUEST_TIMEOUT_MS = Number(process.env.PET_AI_TIMEOUT_MS) || 25000;
const MAX_REPLY_CHARS = 240;

const state = {
  lastError: null,
  lastSuccessAt: null,
  lastProvider: null,
  calls: 0,
  fallbacks: 0,
};

function config() {
  const offline = process.env.PET_AI_OFFLINE === '1';
  const base = (process.env.PET_AI_BASE || DEFAULT_BASE).replace(/\/+$/, '');
  return {
    offline,
    base,
    key: process.env.PET_AI_KEY || '',
    model: process.env.PET_AI_MODEL || DEFAULT_MODEL,
    label: offline ? '本地小脑袋（离线）' : `${new URL(base).host} · ${process.env.PET_AI_MODEL || DEFAULT_MODEL}`,
  };
}

function status() {
  let cfg;
  try {
    cfg = config();
  } catch {
    cfg = { offline: true, label: '本地小脑袋（配置无效）' };
  }
  return { provider: cfg.label, offline: cfg.offline, lastError: state.lastError, lastSuccessAt: state.lastSuccessAt, calls: state.calls, fallbacks: state.fallbacks };
}

function buildSystemPrompt(pet) {
  const hunger = pet.hunger;
  const moodWord =
    hunger >= 70 ? '肚子饱饱的、心情很好' : hunger >= 40 ? '有点饿但还行' : hunger >= 15 ? '很饿，说话没什么力气' : '快饿晕了，只想吃';
  const affectionWord = pet.affection >= 70 ? '非常喜欢主人' : pet.affection >= 35 ? '和主人还在熟悉中' : '有点害羞、刚认识主人';
  const fedLine = pet.hoursSinceFed == null ? '今天还没被喂过' : `上次吃东西是 ${Math.round(pet.hoursSinceFed)} 小时前`;
  return [
    `你是一只住在像素玻璃缸里的宠物，名字叫「${pet.name}」。`,
    `你的形象是主人用像素画的：画布 ${pet.size}×${pet.size}，一共用了 ${pet.colors} 种颜色。`,
    `你现在的状态：${moodWord}；${fedLine}；好感度 ${pet.affection}/100，所以${affectionWord}。`,
    '说话要求：',
    '1. 永远用中文，一次只说 1–2 句，总长度不超过 60 个字，像个小小的活物。',
    '2. 可以偶尔提到自己在缸里看到的东西（云、草、水洼、自己的颜色），但不要长篇描写。',
    '3. 饿的时候会主动讨吃的；被喂饱后会满足、会撒娇。',
    '4. 不要用括号描述动作，不要用 emoji，不要自称 AI、模型、助手。',
    '5. 主人问什么就答什么，答不上来就用宠物的方式反问回去。',
  ].join('\n');
}

async function requestRemote(messages) {
  const cfg = config();
  if (cfg.offline) return { ok: false, error: '已开启离线模式' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const headers = { 'content-type': 'application/json' };
    if (cfg.key) headers.authorization = `Bearer ${cfg.key}`;
    const res = await fetch(`${cfg.base}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: cfg.model, messages, temperature: 0.9, max_tokens: 160 }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `模型接口返回 ${res.status} ${text.slice(0, 120)}` };
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? '';
    const clean = cleanReply(content);
    if (!clean) return { ok: false, error: '模型返回了空内容' };
    return { ok: true, content: clean };
  } catch (err) {
    const reason = err?.name === 'AbortError' ? '模型响应超时' : err?.message || String(err);
    return { ok: false, error: reason };
  } finally {
    clearTimeout(timer);
  }
}

function cleanReply(text) {
  if (typeof text !== 'string') return '';
  let out = text.replace(/\s+/g, ' ').trim();
  out = out.replace(/^["'“”「」]+|["'“”「」]+$/g, '').trim();
  out = out.replace(/（[^）]{0,30}）|\([^)]{0,30}\)/g, '').trim();
  if (out.length > MAX_REPLY_CHARS) out = `${out.slice(0, MAX_REPLY_CHARS)}…`;
  return out;
}

/* ------------------------------------------------------------------ *
 * 本地小脑袋：断网时的兜底，也用作远端失败时的无缝降级
 * ------------------------------------------------------------------ */

const RULES = [
  {
    name: 'greeting',
    test: /(你好|您好|哈喽|嗨|在吗|早|晚上好|hi|hello|hey)/i,
    lines: ['我在缸里呢，刚把脚下的草踩歪了一排。', '你来啦。我一直盯着那片云飘过去，飘得好慢。'],
  },
  {
    name: 'hungry',
    test: /(饿|吃|饭|食物|喂|口粮|饲料|点心)/,
    lines: ['说到吃的……我确实有点饿了，能不能给我一块。', '我闻到你身上有食物的味道了，真的。'],
  },
  {
    name: 'size',
    test: /(多大|尺寸|几像素|多少个格子|多少格|分辨率|像素)/,
    lines: ['我只有 {size} 乘 {size}，你数过吗，我身上的每一格都是你点的。', '{size} 乘 {size} 格，一格不多一格不少，正好装下我。'],
  },
  {
    name: 'color',
    test: /(颜色|什么色|配色|色号|好看吗)/,
    lines: ['我身上有 {colors} 种颜色，{mainColor} 那种是我最喜欢的。', '你给我的颜色我都留着，一共 {colors} 种，一种也没舍得丢。'],
  },
  {
    name: 'name',
    test: /(名字|叫什么|你是谁)/,
    lines: ['我叫 {name}，是你画出来的那个。', '{name}。你取的名字，我一直记着。'],
  },
  {
    name: 'love',
    test: /(喜欢你|爱你|抱|摸|亲|可爱|乖)/,
    lines: ['……那我也蹭你一下，就一下。', '我也是。你别太久不来啊。'],
  },
  {
    name: 'sad',
    test: /(难过|累|烦|压力|不开心|emo|崩溃|焦虑|委屈)/,
    lines: ['那你在缸边坐一会儿吧，我陪你发呆。', '我肚子不大，但可以分你一点。'],
  },
  {
    name: 'bye',
    test: /(再见|拜拜|晚安|走了|下线|睡了)/,
    lines: ['晚安，我会一直在缸里等你回来。', '去忙吧，记得回来给我带吃的。'],
  },
  {
    name: 'play',
    test: /(玩|干嘛|做什么|无聊|游戏|讲讲|聊聊)/,
    lines: ['刚才有只小虫子撞在缸壁上，来回撞了三次，我没笑，真的。', '我把那片最绿的草踩成了平的，算我今天的成果。'],
  },
  {
    name: 'question',
    test: /[?？]|(吗$|呢$|为什么|怎么|什么|哪|谁|如何)/,
    lines: ['这个我答不上来，我只知道缸里的事。你要不要先喂我一口。', '唔……让我想想。想完了，还是想不出来。'],
  },
];

function pickOne(list, seed) {
  return list[Math.abs(seed) % list.length];
}

function hashString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}

/**
 * 本地兜底回复。传入宠物当前状态，让它至少「像活的」。
 */
function localReply({ text, pet, turnIndex = 0 }) {
  const seed = hashString(`${pet.name}|${pet.id}|${text}|${turnIndex}`);
  const ctx = {
    size: pet.size,
    colors: pet.colors,
    name: pet.name,
    mainColor: pet.mainColorName || '最深的那种',
  };

  if (pet.hunger < 15) {
    const hungry = ['我快饿扁了，真的，你看我都站不直了。', '什么都行，给我一点吃的吧，一格也行。'];
    if (seed % 3 !== 0) return pickOne(hungry, seed);
  }

  for (const rule of RULES) {
    if (rule.test.test(text)) {
      return pickOne(rule.lines, seed).replace(/\{(\w+)\}/g, (_, key) => String(ctx[key] ?? ''));
    }
  }

  const hungry = pet.hunger < 45;
  const lonely = pet.affection < 35;
  const idle = hungry
    ? ['我一边听你说，一边在数还剩几粒口粮。', '嗯。你说的时候我肚子叫了一声，不好意思。']
    : lonely
      ? ['你说的我记下了。我们才刚认识，我还在观察你。', '我有点害羞，但我确实在听。']
      : ['我听见了。缸里的风把草吹得沙沙的。', '嗯，然后呢？我在草上坐好了。'];
  return pickOne(idle, seed);
}

/** 喂食时宠物说的一句话（本地生成，不需要联网） */
function eatLine({ pet, foodName = '那块食物' }) {
  const seed = hashString(`${pet.id}${foodName}${Date.now() >> 13}`);
  const good = [`${foodName}好吃，你画的边角有点脆。`, `${foodName}我一口就没了，还有吗。`, '唔，嚼起来是你画的味道。'];
  const ok = [`${foodName}……还行吧，谢谢你。`, '我吃完了，你别看我，我嘴角什么都没有。'];
  return pickOne(pet.affection >= 60 ? good : ok, seed);
}

/**
 * 主入口：优先远端，失败降级本地。
 * @returns {{content:string, source:'ai'|'local', error?:string}}
 */
async function petReply({ text, pet, history = [] }) {
  const messages = [
    { role: 'system', content: buildSystemPrompt(pet) },
    ...history.slice(-8).map((m) => ({ role: m.role === 'pet' ? 'assistant' : 'user', content: m.content })),
    { role: 'user', content: text },
  ];

  state.calls += 1;
  const remote = await requestRemote(messages);
  if (remote.ok) {
    state.lastError = null;
    state.lastSuccessAt = Date.now();
    return { content: remote.content, source: 'ai' };
  }

  state.fallbacks += 1;
  state.lastError = remote.error;
  return {
    content: localReply({ text, pet, turnIndex: history.length }),
    source: 'local',
    error: remote.error,
  };
}

module.exports = { petReply, localReply, eatLine, status, buildSystemPrompt };
