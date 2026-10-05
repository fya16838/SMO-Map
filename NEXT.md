# SMO-Map 项目状态

> 最近更新：**2026-10-05**（译文残留清理 + 收尾整理）

## ✅ 已完成

1. **基础地图**：16 张王国图 / 1234 个标记 / 5376 张瓦片 / 全简体中文 / 进度服务端存档
2. **🏆 成就月亮清单**（`web/achievements.html`）：64 个 Toadette 成就月亮，6 主题分组、进度、导出/导入
   入口：侧边栏「本地增强」
3. **📖 力量之月中文攻略**（点击月亮标记 → 气泡显示）：**16 张地图 / 739 条**
   （2026-10-05 清理后；清理前 728 条 —— 其中 11 条原被旧规则误判成空，清理后恢复）
   - 抓取：`scripts/fetch_all_guides.py`（断点续传 + 429 退避）
   - 翻译：`scripts/translate_guides.py`（术语表 + 分批并发）· 补翻：`scripts/retry_missing_guides.py`
   - 合并：`scripts/build_guides_data.py` → `web/data/guides_zh.json`（560 KB）

4. **进度不再被"刷新"吃掉**（2026-09-26 修）：原站 `ng/app.js` 的 `onbeforeunload`/切图会用
   Angular 模型写回 localStorage，模型未加载完时会写入空集 = 删掉该国家记录。
   现在 `progress-tools.js` 装了双重守卫：① 刷新前摘掉 `onbeforeunload`（5 处 reload）；
   ② 拦住"模型未加载时删非空 `found_marker_ids:*`"。

5. **记录被"错位写入"也修了**（2026-09-26 下午）：切图一瞬间 `body.map.map_id` 已是新地图、
   `body.cats` 还是上一张图 → 把上一张图的 ID 记到新图名下（图上不显示勾、存档却"有数据"）。
   三道保护（都在 `progress-tools.js`）：
   - **归属校验**：按图缓存合法 `marker_id` 表（`/categories`），写入前核对过半 ID 是否属于该图
   - **推送前校验**：本机存在错位记录 → 暂停同步并提示，绝不把坏数据写进服务器存档
   - **载入自愈**：本机记录是"别国 ID"、服务器那份是好的 → 自动用服务器覆盖（提示"已按服务器存档修正"）

6. **译文残留清理**（2026-10-05，全部清零）

| 残留类型 | 清理前 | 处理 |
|---|---:|---|
| `<youtube>…</youtube>` 占位符 | 10 处 | 删除（气泡里另有"查看原站截图"入口）|
| 首行「标题行」（= 名称译文）| 487 条 | 删除；**保留【编号】前缀**并入正文首行（205 条带前缀）|
| IGN 站点套话（「欢迎来到…攻略」「本页包含…」）| 34 条 | 删除 |
| 噪声小标题 / 标签行（`视频指南`、行首 `视频攻略`）| 30 处 | 删除 |
| `bowser-kingdom/42` 正文是整段导航垃圾 | 1 条 | 重新抓取 + 重译 |
| 行首/行尾粘连的「X国力量之月 NN - 名称」| 71 处 | 句级 / 行首 / 行尾三种切法清理 |

清理逻辑已固化在 `scripts/build_guides_data.py` 的 `clean_text()`（可复跑、幂等）。

## 🔧 关键约定

- 改 `web/` 下任何 JS 后，**必须升级 `index.html` 里的 `?v=` 版本号**（否则用户看到缓存旧版）
- ⚠️ **任何 `location.reload()` 之前必须调用 `suppressUnloadSave()`**：否则原站 onbeforeunload
  会用陈旧模型写回 localStorage，删掉/截断该国家的进度
- 地图匹配一律用 **`map_id`**（`body.map.name` 会被 i18n 翻成中文）
- 🚨 **写 `found_marker_ids:N` 前必须校验 ID 归属**：切图瞬间 `map` 已换、`cats` 还是上一张图的
- 验证这类逻辑用 **Node 沙箱**（原 `smo-harness.js` 已被 scratch 的 24h 清理机制删掉，需要时按
  skill `smo-interactive-map` §11e 重建）
- 抓 IGN 用**低并发（2）+ 随机延迟**；被限流（429）等 10-20 分钟再试；**必须清代理**
  （`env -u ALL_PROXY -u all_proxy`）
- 🔴 **IGN 页面已改版（2026-10）**：`fetch_moon_guides.py` 的 `body_of()`（依赖 `View Interactive Map`
  锚点）**已失效**，重抓前必须改成从 `__NEXT_DATA__` 取正文：
  `props.pageProps.page.page.htmlEntities[*].values.html`
  （跳过含 `checkbox` / `mw-selflink` 的元素 —— 那是摘要句与勾选清单）
- 改 `web/data/*.json` 后**要重启服务**（`server.py` 的 `no-store` 现已覆盖 `.json`）
- 🚨 **起沙盒必须同时隔离数据目录**：`SMO_PORT=8792 SMO_DATA=%TEMP%\smo-sandbox python server.py`。
  **只改端口不隔离存档** —— 默认 `data/` 是共享的，而浏览器按 origin 存 localStorage，
  旧沙盒端口（8792）里残留的历史进度会在打开页面时被推回服务器，**覆盖真机存档**
  （2026-10-05 真发生过：1204 勾被换成 9-25 的 870 勾，靠 `progress-backups/` 找回。
  教训还写进 skill 了）

## 📊 当前数据

| 项目 | 数量 |
|---|---|
| 地图 | 16 张 |
| 标记 | 1234 个 |
| 瓦片 | 5376 张 |
| 攻略 | **739 条**（16 图）|
| 成就清单 | 64 条 |
| 进度存档 | `data/progress.json` —— 16 国 / **1204 个勾选**，最后保存 2026-10-02 20:18 |

## 🧹 收尾整理（2026-10-05）

- `scripts/` 下 41 个中间产物 json（16 EN 原件 + 16 zh 中间 + 一次性清单）→ **回收站**
- `__pycache__` ×2（项目根 + scripts）→ **回收站**
- 清理前的 `guides_zh.json` → **回收站**（需要可还原）
- `scripts/` 现在只剩 7 个脚本；项目体积 54 MB → **52 MB**
- ⚠️ **副作用**：中间产物已清，**重跑攻略管线必须先从 IGN 重抓**（且需先修 `body_of()`，见上）
- `data/progress-backups/` 现有 **2 份**（10-02 原始 + 10-05 事故后最新完好），均为 1204 勾；
  事故坏档与冗余重复档已送回收站（2026-10-05 二次清理）。服务端会自动保留最近 20 份（`BACKUP_KEEP`）。

## 🔍 自检工具

| 工具 | 用途 |
|---|---|
| 页面右下角浮层 `📖 帽子国 cap-kingdom 30 条 \| 当前地图: 帽子国 #2` | 看攻略数据/地图识别状态 |
| `?openguide=1` | 自动遍历标记直到找到月亮 → 无人值守验证注入 |
| `grep -c youtube web/data/guides_zh.json` | 应为 **0**（残留清理自检）|
| `curl -s http://127.0.0.1:8791/data/guides_zh.json \| head -c 200` | 确认数据可访问 |

## 🔜 可选后续

- 其他收集品（紫币 / 提示画）可照攻略流程扩展
- 蘑菇王国 64 个成就月亮无坐标（走 `achievements.html` 勾选）
- 若日后重抓攻略：**先修 `fetch_moon_guides.py` 的正文提取**（改版后锚点变了），再跑四步管线
