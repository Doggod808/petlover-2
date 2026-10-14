# 像素宠舍 Pixel Petshed

一个本地运行的小网站：注册账号 → 用像素画一只宠物 → 每天领一份免费口粮喂它 → 和它说话。

画布可选 **32×32 / 64×64 / 128×128**，食物也能自己画（16/32/64）。宠物会记住自己的名字、画布大小、配色，以及此刻饿不饿、和你熟不熟——对话内容都建立在这些之上。

## 跑起来

只需要 Node 18 以上，**没有任何第三方依赖**，不用 `npm install`：

```bash
cd pixel-petshed
node server.js
```

打开 <http://127.0.0.1:5173> 即可。想换端口或让别人在同一局域网访问：

**Windows 上最省事的方式：双击 `启动网站.cmd`。** 它会自己找 Node、起服务、顺手把浏览器打开。窗口关掉就等于关站。

> ⚠️ **不能直接双击 `public/index.html` 预览。** 这个项目不是单文件网页：账号、密码校验、宠物数据、AI 对话都在 Node 服务端，前端还要用 ES 模块和 `/api/*` 请求。用 `file://` 打开只会白屏，必须通过 `node server.js` 访问 <http://127.0.0.1:5173>。

想换端口或让别人在同一局域网访问：

```bash
# PowerShell
$env:PORT=8080; $env:HOST="0.0.0.0"; node server.js
```

自检脚本（会自己起临时端口和临时数据文件，跑完自动清理）：

```bash
node tools/smoke.mjs
```

## 能做什么

| 功能 | 说明 |
| --- | --- |
| 账号 | 注册 / 登录 / 退出。一个账号最多 6 只宠物、30 种食物，可随时切换正在养的那只 |
| 画宠物 | 32/64/128 画布。画笔、橡皮、填色、吸管、左右对称、格线、撤销重做、缩放；有 5 个现成模板（含随机造物），套模板不会顶掉你的调色板 |
| 画食物 | 同样的画板，16/32/64 尺寸。**颜色越多、涂得越满，能量越高**（8–38） |
| 每日口粮 | 每天（北京时间零点刷新）可以免费领 1 份，不领也不累积 |
| 喂食 | 喂一次消耗一份。宠物饱腹度 +能量、好感 +能量/4，吃完会当场说一句话。饥饿度按每小时 3.2 点自然衰减 |
| 对话 | 每只宠物独立记录最近 60 条对话。回答会带上它的名字、尺寸、主色、饱腹与好感 |
| 玻璃缸 | 纯 canvas 画的像素场景：天空色带、飘云、远山近山、草地、花和石子；宠物站在草线上，会呼吸、会蹦、吃东西会掉渣冒爱心 |

## 对话接的是哪个模型

默认走 **Pollinations 的免费公开接口**（OpenAI 兼容、不需要 key）。

想换成别的模型（DeepSeek、智谱、通义、本地 Ollama……只要是 OpenAI 兼容协议）：

```bash
$env:PET_AI_BASE="https://api.deepseek.com/v1"
$env:PET_AI_KEY="sk-你的key"
$env:PET_AI_MODEL="deepseek-chat"
node server.js
```

其它可选变量：

- `PET_AI_OFFLINE=1`：强制离线，只用本地小脑袋（不联网也能对话）。
- `PET_AI_TIMEOUT_MS=25000`：单次请求超时。
- `PET_DATA_FILE=...`：数据文件位置。

**接口不通时不会哑掉**：会自动退回本地小脑袋（关键词规则 + 宠物当前状态），聊天页会注明"这一句是本地小脑袋答的"，并附上失败原因。`GET /api/status` 可以看到当前通道与最近一次错误。

## 数据与安全

- 所有数据在一个文件里：`data/petshed.json`（原子写入，先写临时文件再替换，写坏会备份成 `.broken-<时间>`）。拷走这个文件就等于带走整个玻璃缸。
- **密码不落明文。** 注册时用 `scrypt`（N=16384, r=8, p=1，每个账号独立 16 字节随机盐）派生后存储；登录用 `crypto.timingSafeEqual` 比较；用户名不存在时也会空跑一次同等开销的派生，避免用时间差探测账号是否存在。响应里永远不含哈希、盐或会话令牌。
- 会话：32 字节随机 token 放在 `HttpOnly` + `SameSite=Lax` cookie 里，有效期 30 天，服务端可随时吊销。
- 其它防护：写操作做同源检查；注册/登录/对话/写接口都有按 IP 或账号的限流；请求体上限 1.2MB；像素数据严格校验（尺寸、调色板长度、行程长度必须正好铺满画布）；静态服务禁止路径穿越；带 CSP、`nosniff`、`X-Frame-Options: DENY` 等响应头。
- **上线前请自行补上 HTTPS**（Nginx/Caddy 反代即可，`X-Forwarded-Proto: https` 会自动给 cookie 加 `Secure`），并把 `HOST` 改成 `0.0.0.0` 之外只监听反代地址。当前设计面向"自己和朋友用"的规模，不是高并发生产环境。

## 想放到网上给人玩

这个项目有两条部署路线，用同一套业务代码（`src/api.js`），区别只在**入口**和**数据存哪**：

| 路线 | 入口 | 数据 | 适合 |
| --- | --- | --- | --- |
| 常驻进程 | `server.js` | 本地/挂载盘上的 `data/petshed.json` | 自己的电脑、VPS、NAS、Docker |
| Serverless | `api/*.js` | **Redis**（Upstash 等，走 REST） | Vercel 这类无常驻进程、文件系统只读的平台 |

### Vercel 部署（已支持，但必须配一个 Redis）

原来那个 `500: FUNCTION_INVOCATION_FAILED` 的根因是 Vercel 的模型对不上文件存储：部署目录**只读**，只有 `/tmp` 可写且随时被清空，`data/petshed.json` 根本落不了盘。现在入口改成了 `api/*.js` 函数，存储换成 Redis，问题就没了。

步骤：

1. **准备 Redis**：在 Vercel 里打开 Marketplace，装一个 **Upstash Redis**（有免费额度）并关联到本项目。它会自动往项目里注入 `UPSTASH_REDIS_REST_URL` 和 `UPSTASH_REDIS_REST_TOKEN`（老版本叫 `KV_REST_API_URL` / `KV_REST_API_TOKEN`，两种名字代码都认）。
2. **部署**：把仓库连上 Vercel，或者在本机跑 `npx vercel`。`vercel.json` 已经写好：静态文件出 `public/`，`api/**/*.js` 是函数，最长执行 60 秒。
3. **（可选）换模型**：在项目中加环境变量 `PET_AI_BASE` / `PET_AI_KEY` / `PET_AI_MODEL`。不加就用默认的免费公开接口。
4. **访问** `https://<你的项目>.vercel.app`，然后照着下面这个清单点一遍。

**如果 Vercel 是从某个 Git 仓库拉代码的**：这个目录已经是一个现成的 git 仓库（分支 `main`，`.gitignore` 里排除了 `data/`）。双击 `推送到仓库.cmd`，把仓库地址粘进去，它就会 `git push`，Vercel 随后自动重新部署。远端已经有提交导致 push 被拒时，脚本会告诉你是该先 `git pull --rebase` 还是 `--force`。

**关于函数数量（Hobby 计划的坑）**：Hobby 每次部署**最多 12 个 Serverless 函数**，超了会直接报「构建失败：部署最多只能添加 12 个无服务器函数」。所以 `api/` 下刻意只有 **8 个文件**（`status` / `me` / `state` / `auth` / `pets` / `foods` / `feed` / `chat`），路由里可变的部分全部走查询串，例如：

```
POST /api/auth?action=register
PUT  /api/pets?id=p_1a2b3c
POST /api/pets?action=activate&id=p_1a2b3c
POST /api/foods?action=daily
POST /api/chat?action=clear
```

**别在 `api/` 里用 `[id].js` 这种方括号动态路由**——那是 Next.js 的语法，普通项目不保证支持，而且每个文件都会占掉一个函数名额。本机版（`server.js`）两种写法都接受，所以老路径式 URL 照样能用。

### 部署出问题了先看这三个地方

**1）打开 `https://你的域名/api/status`。** 它不碰登录态，会自己把存储状态报出来：

```json
{ "ok": true, "ai": { "...": "..." }, "today": "2026-10-14",
  "storage": { "kind": "redis", "ok": true, "detail": "PONG" } }
```

对照着看：

| 现象 | 意思 |
| --- | --- |
| `"kind": "none"` + error 里写「没有配置 Redis 存储」 | 环境变量没配，**或者配完没有重新部署**（Vercel 加完环境变量必须 redeploy 才生效） |
| `"ok": false`，错误里有 `401` / `WRONGPASS` | token 不对，重新复制一遍 Upstash 的值 |
| `"ok": false`，错误里有 `fetch failed` / `ENOTFOUND` | 函数连不出公网，或 REST URL 写错了 |
| `"kind": "file"` 出现在线上 | 它退回了文件存储 —— Vercel 的部署目录只读，注册登录必然失败 |
| `"detail": "PONG"` | 存储是通的，问题在别处（去看第 3 条） |

**2）页面上那条红色提示现在会直接写出真实原因。** 存储类故障（没配 Redis、写不了盘、连不上）会被如实带到提示框里，不再统一压成「服务器出了点问题」。

**3）要看完整堆栈**：Vercel → 你的项目 → **Logs**（Runtime Logs），复现一次操作，找 `[api] 处理出错` 那一行，那里有异常名和调用栈。

**第一次部署后请手动点一遍**（自动化测试用的是假 Redis，真环境要自己确认一次）：注册 → 画一只宠物 → 领今日口粮 → 喂给它 → 说一句话 → 刷新页面看登录态还在不在 → 换个浏览器/无痕窗口注册第二个账号，确认两边互相看不到宠物。

部署到 Vercel 后的几个真实约束：

- **数据全在一个 Redis key 里**（`petshed:db` + 一个版本号）。朋友规模完全够用；真到几百人、宠物图堆起来，就该按用户拆 key 了。
- **限流是按函数实例内存计数的**，冷启动会重置。想严格限流得把计数也放进 Redis。
- **区域默认在美东（iad1）**，国内访问会偏慢。可以在 Settings → Functions 里改成香港或新加坡。
- Hobby 计划单个函数最长 300 秒，模型调用 25 秒超时，够用。
- 会话仍然存在 Redis 里，所以多实例之间是共享的（这点和纯 Serverless 的常见坑不一样）。

### 路线一：自己的电脑 + 内网穿透

**最快让朋友看到，不改变任何代码**

```powershell
# 窗口 A：起站点（双击 启动网站.cmd 也一样）
node server.js
```

```powershell
# 窗口 B：起隧道，把本机 5173 映射成一个临时公网地址
cloudflared tunnel --url http://127.0.0.1:5173
```

cloudflared 会在窗口 B 里打印一条 `https://xxxx.trycloudflare.com`，把这条发给朋友就行。没装 cloudflared 的话，从 Cloudflare 官方 release 下一个单文件 exe 直接跑，不需要注册账号。

几点要注意：隧道期间你这台电脑就是在公网开着小站（**只映射这一个端口**，用完 Ctrl+C 关掉）；这条临时地址每次重启隧道都会变；你的电脑关机或睡眠，朋友那边就打不开了。

（只有"不用隧道、想让同一个 WiFi 下的朋友直接访问"时，才需要 `$env:HOST="0.0.0.0"; node server.js` —— 那会把站点暴露到整个局域网，别在公共 WiFi 下这么干。）

### 路线二：Docker（本仓库自带配置）

```bash
docker compose up -d      # 数据落在 ./data，容器重建也不丢
```

任何支持常驻容器的环境都行：自己的服务器、群晖 NAS、Railway、Render、Fly.io。

### 路线三：任意云主机 / VPS / NAS

要点只有三个：启动命令 `node server.js`；环境变量 `HOST=0.0.0.0`、`PET_DATA_FILE=/data/petshed.json`；把一块持久磁盘挂到 `/data`。HTTPS 交给 Caddy/Nginx 终止并记得透传 `X-Forwarded-Proto: https`（这样登录 cookie 会自动带上 `Secure`）。

### 上线前的三条安全提醒

1. **别把 `data/` 提交到公开仓库**（已经写进 `.gitignore` 了）：那个文件里是所有账号的密码哈希。
2. 公网部署**必须走 HTTPS**，否则 cookie 可能被中间人截走。
3. 模型密钥放平台的环境变量里，别写进代码或 README。

## 目录结构

```
pixel-petshed/
├── 启动网站.cmd           # Windows 双击即跑（自动找 Node、起服务、开浏览器）
├── server.js              # 常驻进程入口（本机 / VPS / Docker）
├── api/                   # Serverless 入口（Vercel）：每个文件对应一条路由
├── Dockerfile             # 常驻容器部署用
├── docker-compose.yml     # 同上，带 ./data 持久卷
├── vercel.json            # Vercel：静态目录、函数时长、安全响应头
├── src/
│   ├── api.js             # 全部接口 + 限流 + 状态视图（两个入口共用）
│   ├── auth.js            # scrypt 哈希、会话、cookie
│   ├── sprite.js          # 像素数据校验/编解码、每日口粮图案
│   ├── ai.js              # 模型通道 + 本地小脑袋兜底
│   ├── db.js              # 存储层：文件版 + Redis 版（版本号 CAS，接口一致）
│   ├── http.js            # 两个入口共用的响应头/请求体处理
│   ├── vercel.js          # Serverless 入口工厂（路由模板 → api/*.js）
│   └── static.js          # 静态文件
├── public/
│   ├── index.html
│   ├── css/               # base（令牌）/ landing / app
│   ├── brand/favicon.svg
│   └── js/
│       ├── main.js        # 状态中心 + hash 路由 + 顶栏
│       ├── terrarium.js   # 像素玻璃缸（场景 + 宠物动画 + 粒子）
│       ├── editor.js      # 像素画板
│       ├── presets.js     # 内置模板（按比例生成，任何尺寸都可用）
│       ├── sprite.js      # 编解码、缩放、颜色工具
│       ├── paint.js       # 工作态像素工具 + 缩略图
│       ├── dom.js / api.js
│       └── screens/       # landing / auth / den / bag / talk / draw
├── tools/smoke.mjs        # 端到端冒烟测试
└── data/petshed.json      # 运行时生成，含全部账号与作品（请勿公开）
```

## 像素数据格式

```json
{
  "size": 32,
  "palette": ["#3fa46a", "#f0426b"],
  "runs": [[120, -1], [64, 0], [8, 1], [832, -1]]
}
```

`runs` 是行程编码：`[连续格数, 调色板下标]`，下标 `-1` 表示透明，展开后必须正好 `size × size` 个格子。这样 128×128 的大图也只有几十 KB。

## 想继续加东西

- 加宠物模板：在 `public/js/presets.js` 里写一个 `(size) => working` 的函数，按比例画，任何尺寸都能用，然后加进 `PRESETS`。
- 加装饰物/天气：都在 `public/js/terrarium.js` 的 `renderScene()` 里，逻辑坐标是 160 宽。
- 加新接口：`src/api.js` 里照现有的形状加一段，注意把返回值限定成显式字段。

改动前端后如果样式没生效，浏览器按 Ctrl+F5 强刷一次（静态文件带 ETag）。
