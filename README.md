# 超级马力欧 奥德赛 · 本地互动地图（简体中文离线版）

把粉丝互动地图站 **smo.game-maps.info** 的《超级马力欧 奥德赛》收集地图**完整复刻到本地**：
16 张王国地图、1234 个收集点、**739 条中文月亮攻略**、64 条成就月亮清单，界面全简体中文，
**进度三重保险（关浏览器 / 清缓存 / 换端口都不会丢）**，全程离线可用。

<!-- TODO: 在这里插入一张截图（建议放到 docs/screenshot.png 后改成 <img src="docs/screenshot.png">） -->

---

> ## ⚠️ 非官方粉丝项目声明（请先读）
>
> - 本项目为**非官方、非商业、无赞助、无背书**的粉丝作品，与 **任天堂（Nintendo）**、**IGN**、
>   **smo.game-maps.info** 及其作者**均无关联**。
> - 本项目**不包含**游戏本体、ROM、存档数据、密钥、破解工具或任何作弊/外挂功能。
>   **使用前请自备正版《超级马力欧 奥德赛》游戏**。
> - 本项目**不提供**任何绕过版权保护或盗版下载的内容。
> - 仅供**个人学习、离线记录收集进度**使用。**请勿再分发**本仓库内容。
> - 全部游戏相关名称、术语、角色、图像版权归 **任天堂** 所有；地图图片与攻略数据版权归 **IGN** 所有。
> - 如相关权利人提出要求，本项目将立即删除对应内容或整个仓库（见下方「侵权处理」）。

---

## ✨ 功能

| 功能 | 说明 |
|---|---|
| **16 张王国互动地图** | 1234 个标记（力量之月、紫币、提示画、检查点、商店、桃花公主位置等），5376 张瓦片**全部本地化**，断网可用 |
| **全简体中文** | 界面词条 + 标记名 + 攻略正文全中文，可切换繁體中文 / English |
| **📖 中文月亮攻略** | 点击地图上的金色月亮标记 → 气泡内显示**获取方法**（位置象限 + 分步骤操作 + 原站截图链接），覆盖 16 图 / **739 条** |
| **🏆 成就月亮清单** | 蘑菇王国 Toadette 的 64 个成就奖励月亮（无地图坐标）单独做成勾选清单页，按主题分 6 组、带进度条与搜索 |
| **点击即标记** | 点标记或侧栏条目 = 标记为已收集（可再点取消），标记变淡 |
| **分类批量操作** | 点分类标题可整类设为已收集 / 重置 |
| **搜索** | 侧栏搜索框，多个关键词用 `;` 隔开 |
| **隐藏已发现** | 设置里可勾选，已收集的标记从地图上隐藏 |
| **进度三重保险** | 秒级自动保存 + 服务端存档 + 滚动备份（详见下文） |
| **进度导出 / 导入** | 一键导出 JSON 留档，换电脑/换浏览器/重装都能恢复 |
| **从备份恢复** | 从服务端滚动备份里**按国家补缺**或**整份替换**，误覆盖也能救回 |

---

## 🚀 使用方法

### 环境要求

- **Python 3.8+**（`server.py` 只用标准库，**无需安装任何第三方依赖**）
- 现代浏览器：Chrome / Edge / Firefox / Safari 均可（推荐 Chrome / Edge）
- 无需联网（攻略里的 YouTube 链接、原站截图链接需要联网才可打开）

### 方式 A：Windows 一键启动（推荐）

1. 下载或克隆本仓库到任意目录
2. 双击 **`start.bat`** —— 会自动寻找 Python 并启动本地服务
3. 浏览器访问 **<http://127.0.0.1:8791/>**
4. 用完关掉那个黑色命令行窗口即可

> 启动窗口会**打印访问地址**，不会自动弹浏览器。

### 方式 B：手动启动（跨平台）

```bash
python server.py
# 或换端口：
#   Windows (cmd):  set SMO_PORT=9000 && python server.py
#   PowerShell:     $env:SMO_PORT=9000; python server.py
#   bash/zsh:       SMO_PORT=9000 python server.py
```

### 方式 C：纯静态托管（不需要 Python 或用别的静态服务器）

`web/` 就是完整站点根目录，可直接用任意静态服务器托管：

```bash
python -m http.server 8791 --directory web
```

> ⚠️ 纯静态模式下「服务端存档 / 从备份恢复」不可用（这两个依赖 `server.py` 的 `/progress` 接口）；
> 进度仍会自动存在浏览器 localStorage 里。

### 沙盒 / 多开（进阶）

要同时跑一份用于折腾的实例、且**不碰正式存档**，必须同时隔离端口与数据目录：

```bash
# Windows
set SMO_PORT=8792 && set SMO_DATA=%TEMP%\smo-sandbox && python server.py
# bash
SMO_PORT=8792 SMO_DATA=/tmp/smo-sandbox python server.py
```

> ❗ 只改端口**不隔离存档**：`data/` 是共用的，而浏览器按 origin 存 localStorage，
> 旧实例端口里残留的历史进度会在打开页面时被推回存档。**务必带上 `SMO_DATA`。**

---

## 🎮 界面操作

| 操作 | 位置 / 方式 |
|---|---|
| 标记已收集 | 点地图上的标记，或点侧栏里的标记名（再点取消）|
| 整类操作 | 点侧栏分类标题（如「力量之月」）= 整类已收集 / 重置 |
| 搜索标记 | 侧栏搜索框，`;` 分隔多个关键词 |
| 显示 / 隐藏全部 | 侧栏按钮 |
| 标记大小 | 设置 → 标记大小（60%–200%）|
| 语言 | 设置 → 语言（简体中文 / 繁體中文 / English）|
| 看月亮攻略 | 点金色月亮标记 → 气泡里「📖 获取方法」|
| 成就月亮清单 | 侧栏「本地增强」→ 🏆 成就月亮清单 (64)，或直接开 `achievements.html` |
| 导出 / 导入进度 | 底部按钮「导出进度」「导入进度」（弹窗 / 文件选择）|
| 从备份恢复 | 底部按钮「从备份恢复」→ 选一份备份，可**补缺**或**整份替换** |

> 💡 看不到"已找到"的勾时，先检查设置里是否勾了 **「隐藏已发现的标记」**（勾选后已收集的标记会从图上移除）。

---

## 💾 进度保存机制（为什么不会丢）

原站的进度只存在浏览器 `localStorage`，换浏览器、清缓存、**换端口（不同 origin）**都会消失。
本项目加了三层保护：

1. **秒级自动保存**：变更后自动写入浏览器存储（数据签名没变则跳过）
2. **服务端权威存档**：写入 `data/progress.json`；载入时按国家**逐键补缺**（不会用旧状态覆盖新进度）
3. **滚动备份 + 恢复入口**：每次覆盖前把旧存档滚进 `data/progress-backups/`（保留最近 20 份），
   底部「从备份恢复」可列出备份并**按国家补缺**或**整份替换**

另外还有防呆：写入前校验标记 ID 是否属于当前地图（防切图瞬间错位写入）、单次推送若会**整国消失**会暂停同步并红字提示。

---

## 📁 目录结构

```
.
├── start.bat                 # Windows 一键启动（自动找 Python）
├── server.py                 # 本地服务：静态文件 + 进度存档 / 备份恢复接口
├── README.md                 # 本说明
├── NEXT.md                   # 项目状态、数据口径与维护约定（开发者向）
├── data/
│   ├── progress.json         # 进度服务端存档（自动生成/写入）
│   └── progress-backups/     # 覆盖前的滚动备份（自动生成，保留最近 20 份）
├── scripts/                  # 数据管线（攻略抓取/翻译/合并、瓦片下载等）
└── web/                      # 网站本体（= 站点根目录）
    ├── index.html            # 主地图页
    ├── achievements.html     # 成就月亮清单页
    ├── css/  js/             # 样式 + 进度工具（本项目的本地增强都在 progress-tools.js）
    ├── vendor/               # 第三方库（全部本地化）
    ├── ng/                   # 原站前端逻辑与模板
    ├── data/                 # 地图列表 / 标记数据 / 多语言文本 / 中文攻略
    ├── img/                  # 标记图标
    └── map/<王国>/<z>/       # 地图瓦片（16 王国 × 336 张 = 5376 张）
```

**数据规模**：16 张地图 · 1234 个标记 · 5376 张瓦片（约 50 MB）· 739 条中文攻略 · 64 条成就清单。
仓库总体积约 **52 MB**（主要是瓦片）。

---

## ⚖️ 来源、版权与致谢

本项目的代码与数据**均来自以下已公开的来源**，此处逐一注明。

### 1. 前端与界面逻辑

- **来源：[smo.game-maps.info](https://smo.game-maps.info/)** —— 粉丝制作的《超级马力欧 奥德赛》互动地图站。
  本仓库**复刻并保留了原站的前端结构、页面模板与交互逻辑**（AngularJS 1.8 + Leaflet 1.7 + Bootstrap 5 体系），
  在此基础上做了本地化改造：数据落地本地、界面与标记名中文化、进度持久化增强（`web/js/progress-tools.js`）。
- **原站界面署名**为 `GMS | IGN`（即其地图数据与图片来自 IGN）。

### 2. 地图瓦片与标记数据

- **地图瓦片（5376 张 PNG）**：来自原站的图层，其**版权与署名归 [IGN](https://www.ign.com/)**。
- **标记数据（1234 条：力量之月 / 紫币 / 提示画 / 检查点 / 商店 / 桃花公主位置等）**：
  抓取自 **IGN 互动地图的公开 GraphQL 接口**
  `https://mollusk.apis.ign.com/graphql`（`objectSlug = super-mario-odyssey`），
  坐标经本地换算为地图世界坐标。
- **标记图标与图片**：`web/img/`（icon、icon-s、marker-bg）来自原站 / IGN。

### 3. 攻略正文与翻译

- **攻略正文（739 条，覆盖 16 张地图）**：抓取自 **IGN Wiki** 的
  《Super Mario Odyssey》Power Moon 详情页（`https://www.ign.com/wikis/super-mario-odyssey/`）。
- **中文翻译**：由机器翻译（DeepSeek）+ 官方术语表校对（力量之月、碧姬公主、奇诺比奥队长、凯皮、
  慢慢龟、月之石、提示画、栗子小子、邦尼特、斯芬克斯、附身 等）。
- **界面中文词条**：OpenCC（`t2s`）转换 + 术语修正表。

### 4. 第三方开源库

| 库 | 用途 |
|---|---|
| AngularJS 1.8 | 原站前端框架 |
| Leaflet 1.7 (+ OverlappingMarkerSpiderfier) | 地图渲染与重叠标记展开 |
| Bootstrap 5 / Bootstrap Icons | 界面样式与图标 |
| jQuery / jQuery UI | 原站依赖 |
| i18next | 多语言 |
| toastr | 提示条 |

各库版权归各自作者所有，遵循其原始许可。

### 5. 游戏本体

**《超级马力欧 奥德赛》（Super Mario Odyssey）** 及其全部名称、术语、角色、图像、音乐的著作权与商标权
归 **任天堂（Nintendo）** 所有。本项目**不包含任何游戏本体内容**，使用前请自备正版游戏。

---

## 🚫 免责声明与使用限制

1. 本项目为**非官方粉丝项目**，非商业用途，与任天堂、IGN、smo.game-maps.info 均无任何关联，
   未获得其赞助、授权或认可。
2. 本项目**不提供游戏本体、ROM、存档文件、密钥、破解或作弊功能**，也不提供任何绕过版权保护的途径。
3. 本项目仅供**个人学习、离线记录游戏收集进度**使用。请**勿再分发**、勿用于商业用途。
4. 若本项目内容与你的权益产生冲突，请按下方方式联系，我们将**立即配合删除**。

---

## 📧 侵权处理与删除请求（Takedown / Contact）

**中文**

我们尊重知识产权。如你是版权人或其授权代理（包括但不限于 **任天堂 / Nintendo**、**IGN**、
**smo.game-maps.info 的作者**），认为本仓库的任何内容侵犯了你的权利，请发送邮件至：

> 📮 **fya16838@163.com**

邮件中请注明（一封说明邮件即可，**无需任何法律文书**）：

1. 你的身份，以及你所主张的权利（例如某张地图瓦片、某段攻略文本、某部分前端代码的版权）；
2. 涉及的具体内容（文件路径、页面 URL 或可定位的描述）；
3. 你希望我们采取的措施（删除个别文件 / 删除某类内容 / 下架整个仓库）。

**我们承诺：收到有效通知后 72 小时内删除相关内容，或按要求下架整个仓库，并回复确认。**

---

**English**

We respect intellectual property rights. If you are a copyright holder or an authorized agent
(including but not limited to **Nintendo**, **IGN**, or the author(s) of **smo.game-maps.info**) and
believe that any content in this repository infringes your rights, please email:

> 📮 **fya16838@163.com**

Please include (a clear email is enough — **no legal paperwork is required**):

1. Your identity and the rights you hold (e.g. a specific map tile, guide text, or front-end code);
2. The specific content concerned (file path, page URL, or a locatable description);
3. The action you request (remove specific files / remove a category of content / take down the entire repository).

**We commit to removing the relevant content — or taking down the whole repository — within 72 hours
of receiving a valid request, and to replying to confirm.**

---

## ❓ 常见问题

**Q：双击 `start.bat` 后浏览器打开是空白 / 提示端口被占用？**
服务可能已经在运行了 —— 直接访问 <http://127.0.0.1:8791/> 即可；要重启就先关掉旧的命令行窗口。

**Q：想换端口？**
`set SMO_PORT=9000` 后再运行 `start.bat` / `python server.py`。
（注意：换端口 = 换 origin，浏览器里的旧进度不会自动带过去；服务端存档不受影响。）

**Q：地图某块显示空白？**
本仓库已包含完整瓦片（5376 张）。若你删掉过 `web/map/` 下的文件，会缺底图。

**Q：我的进度"不见了"？**
先检查设置里是不是勾了 **「隐藏已发现的标记」**；其次确认是否换了浏览器或端口
（进度按 origin 隔离，服务端存档会在打开页面时补缺回来）。

**Q：换电脑怎么带走进度？**
底部「导出进度」存成 JSON，新电脑上「导入进度」；或直接拷贝 `data/progress.json`。

**Q：攻略里的视频/截图打不开？**
气泡里的原站截图与视频链接需要联网访问 IGN，离线时只显示中文文字攻略。

**Q：能加紫币 / 提示画的攻略吗？**
可以 —— `scripts/` 里的管线按攻略流程扩展即可（见 `NEXT.md`）。

---

## 🛠 技术说明（简要）

- `server.py`：单文件、仅标准库的本地服务。除静态文件外提供：
  `GET/POST /progress`（进度存档）、`GET /progress/backups`、`POST /progress/restore`（备份恢复）、
  `GET /categories?map_id=N`（校验标记归属）。对 `.html/.js/.json` 发送 `Cache-Control: no-store`，
  改完文件刷新即生效（瓦片与图片照常走缓存）。
- 前端增强集中在 `web/js/progress-tools.js`（进度面板、同步与防覆盖守卫、攻略气泡注入、诊断浮层）。
- 数据管线在 `scripts/`：攻略抓取 → 翻译 → 补翻 → 合并生成 `web/data/guides_zh.json`。

---

## 📄 许可（License）

本项目**不适用开源许可**（No license / All rights reserved by the respective owners）。

- 游戏相关内容：© Nintendo
- 地图瓦片与攻略数据：© IGN
- 前端结构与页面逻辑：© smo.game-maps.info 的作者
- 本仓库仅作个人学习与离线收藏用途，**请勿再分发**。

---

<sub>本项目为粉丝作品，若有侵权请联系 **fya16838@163.com**，我们会立即删除。</sub>
