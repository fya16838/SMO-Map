#!/usr/bin/env python3
"""
SMO Map —— 本地服务

作用：把浏览器发出的 API 请求（/maps、/categories、/i18nText…）映射到
本地 data/*.json，其余请求按静态文件从 web/ 目录提供。

  python server.py            # 默认端口 8791
  SMO_PORT=9000 python server.py
"""
import json
import os
import pathlib
import re
import sys
import os
import pathlib
import sys
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

PORT = int(os.environ.get("SMO_PORT", "8791"))
ROOT = pathlib.Path(__file__).resolve().parent
WEB = ROOT / "web"
DATA = WEB / "data"

# ---------- 进度持久化（解决"关浏览器/清缓存进度就丢"） ----------
# 原站把已收集状态只放在浏览器 localStorage 里：清站点数据、换浏览器、
# 甚至换端口（不同 origin）都会丢。这里在服务端留一份权威副本。
#
# ⚠️ 沙盒/测试务必用 SMO_DATA 指向独立目录！
#    只改端口**不隔离存档**：默认 data/ 是共享的，旧 origin 里的历史 localStorage
#    会在打开页面时把旧状态推回来，覆盖真机存档（2026-10-05 真发生过，靠备份找回）。
#    例：SMO_PORT=8792 SMO_DATA=%TEMP%\smo-sandbox python server.py
ROOT_DATA = pathlib.Path(os.environ.get("SMO_DATA") or (ROOT / "data"))
PROGRESS_FILE = ROOT_DATA / "progress.json"
PROGRESS_BACKUPS = ROOT_DATA / "progress-backups"
BACKUP_KEEP = 20


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB), **kwargs)

    # ---------- helpers ----------
    def _send_bytes(self, body: bytes, ctype: str, code: int = 200):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _send_json_file(self, path: pathlib.Path):
        if not path.exists():
            return self._send_json({"error": -1, "data": None})
        self._send_bytes(path.read_bytes(), "application/json; charset=utf-8")

    def _send_json(self, obj):
        self._send_bytes(
            json.dumps(obj, ensure_ascii=False).encode("utf-8"),
            "application/json; charset=utf-8",
        )

    # ---------- routes ----------
    def do_GET(self):
        u = urlparse(self.path)
        path, qs = u.path, parse_qs(u.query)

        if path == "/maps":
            return self._send_json_file(DATA / "maps.json")
        if path == "/languages":
            return self._send_json_file(DATA / "languages.json")
        if path == "/allCategories":
            return self._send_json_file(DATA / "allCategories.json")
        if path == "/categories":
            map_id = (qs.get("map_id") or ["1"])[0]
            return self._send_json_file(DATA / f"categories_{map_id}.json")
        if path == "/i18nText":
            iso = (qs.get("iso_code") or ["en"])[0]
            return self._send_json_file(DATA / f"i18n_{iso}.json")
        if path == "/progress":
            return self._send_json_file(PROGRESS_FILE)
        if path == "/progress/info":
            return self._send_json(self._progress_info())
        if path == "/progress/backups":
            return self._send_json(self._progress_backups())
        if path in ("/marker/save", "/marker/report"):
            # 本地镜像是只读的：标记编辑/上报在原站可用，这里不接
            return self._send_json({"error": -1, "data": None})

        # 其余走静态文件（瓦片 /map/...、图标 /img/...、/vendor/... 等）
        return super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/progress":
            return self._progress_save()
        if path == "/progress/restore":
            return self._progress_restore()
        # 编辑器/上报端点：本地镜像不支持
        length = int(self.headers.get("Content-Length") or 0)
        if length:
            self.rfile.read(length)
        self._send_json({"error": -1, "data": None})

    # ---------- 进度持久化实现 ----------
    def _read_body(self) -> bytes:
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        return self.rfile.read(length) if length > 0 else b""

    def _progress_info(self):
        if not PROGRESS_FILE.exists():
            return {"error": -1, "data": None, "saved_at": None, "keys": 0, "backups": 0}
        try:
            doc = json.loads(PROGRESS_FILE.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {"error": -1, "data": None, "saved_at": None, "keys": 0, "backups": 0}
        backups = len(list(PROGRESS_BACKUPS.glob("progress-*.json"))) if PROGRESS_BACKUPS.exists() else 0
        return {"error": 0, "saved_at": doc.get("_saved_at"),
                "keys": len(doc.get("data") or {}), "backups": backups}

    # ---------- 进度持久化实现 ----------
    def _read_body(self) -> bytes:
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        return self.rfile.read(length) if length > 0 else b""

    @staticmethod
    def _summary_of(path: pathlib.Path):
        """读一个存档文件 → {saved_at, maps, markers, keys}；读不出来返回 None"""
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        data = doc.get("data") or {}
        maps = markers = 0
        for k, v in data.items():
            if isinstance(k, str) and k.startswith("found_marker_ids:"):
                n = len([x for x in str(v).split(",") if x.strip()])
                if n:
                    maps += 1
                    markers += n
        return {"saved_at": doc.get("_saved_at"), "maps": maps,
                "markers": markers, "keys": len(data)}

    def _progress_info(self):
        info = self._summary_of(PROGRESS_FILE)
        if info is None:
            return {"error": -1, "data": None, "saved_at": None, "keys": 0, "backups": 0}
        info["error"] = 0
        info["data"] = None
        info["backups"] = (len(list(PROGRESS_BACKUPS.glob("progress-*.json")))
                           if PROGRESS_BACKUPS.exists() else 0)
        return info

    def _progress_data(self) -> dict:
        """当前存档的 data 字段（读不出来就是空字典）"""
        if not PROGRESS_FILE.exists():
            return {}
        try:
            return json.loads(PROGRESS_FILE.read_text(encoding="utf-8")).get("data") or {}
        except (OSError, ValueError):
            return {}

    def _backup_current(self) -> bool:
        """把当前存档滚动备份进 progress-backups/（保留最近 BACKUP_KEEP 份）"""
        if not PROGRESS_FILE.exists():
            return False
        try:
            old_text = PROGRESS_FILE.read_text(encoding="utf-8")
        except OSError:
            return False
        if not old_text:
            return False
        PROGRESS_BACKUPS.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        dst = PROGRESS_BACKUPS / f"progress-{stamp}.json"
        n = 1
        while dst.exists():                     # 同一秒内多次备份也不互相覆盖
            dst = PROGRESS_BACKUPS / f"progress-{stamp}-{n}.json"
            n += 1
        try:
            dst.write_text(old_text, encoding="utf-8")
        except OSError:
            return False
        files = sorted(PROGRESS_BACKUPS.glob("progress-*.json"))
        for f in files[:-BACKUP_KEEP]:
            try:
                f.unlink()
            except OSError:
                pass
        return True

    def _write_progress(self, data: dict):
        """原子写存档（先写 .tmp 再 replace）：返回 (saved_at, 存盘文档)"""
        saved_at = datetime.now().astimezone().isoformat(timespec="seconds")
        out = {
            "_app": "SMO-Map-Local",
            "_version": 2,
            "_saved_at": saved_at,
            "_maps": sum(1 for k in data if k.startswith("found_marker_ids:")),
            "data": data,
        }
        tmp = PROGRESS_FILE.with_name(PROGRESS_FILE.name + ".tmp")
        tmp.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
        os.replace(tmp, PROGRESS_FILE)
        return saved_at, out

    def _progress_save(self):
        body = self._read_body()
        try:
            doc = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            return self._send_json({"error": -1, "message": "invalid json"})
        data = doc.get("data")
        if not isinstance(data, dict):
            return self._send_json({"error": -1, "message": "missing data"})

        ROOT_DATA.mkdir(parents=True, exist_ok=True)

        # 仅当进度内容真的变了才备份旧版（滚动保留 BACKUP_KEEP 份）
        old_data = self._progress_data()
        same = (json.dumps(old_data, sort_keys=True, ensure_ascii=False)
                == json.dumps(data, sort_keys=True, ensure_ascii=False))
        if not same:
            self._backup_current()

        saved_at, out = self._write_progress(data)
        return self._send_json({"error": 0, "ok": True, "saved_at": saved_at,
                                "keys": len(data), "maps": out["_maps"]})

    def _progress_backups(self):
        """GET /progress/backups：列出滚动备份（新 → 旧）+ 当前存档摘要"""
        items = []
        if PROGRESS_BACKUPS.exists():
            for f in sorted(PROGRESS_BACKUPS.glob("progress-*.json"), reverse=True):
                info = self._summary_of(f)
                if info is None:
                    continue
                info["name"] = f.name
                try:
                    info["size"] = f.stat().st_size
                except OSError:
                    info["size"] = 0
                items.append(info)
        return {"error": 0, "count": len(items), "items": items[:BACKUP_KEEP],
                "current": self._summary_of(PROGRESS_FILE)}

    def _progress_restore(self):
        """POST /progress/restore {name, mode}：从某份备份恢复存档
        mode=merge（默认）只补回当前缺失的国家；mode=replace 整份替换。
        恢复前会把当前存档也备份一份，所以恢复动作本身可回退。"""
        body = self._read_body()
        try:
            req = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            return self._send_json({"error": -1, "message": "invalid json"})
        name = str(req.get("name") or "")
        mode = str(req.get("mode") or "merge").lower()
        if not re.fullmatch(r"progress-\d{8}-\d{6}(-\d+)?\.json", name):
            return self._send_json({"error": -1, "message": "备份文件名不合法"})
        src = (PROGRESS_BACKUPS / name).resolve()
        if src.parent != PROGRESS_BACKUPS.resolve() or not src.exists():
            return self._send_json({"error": -1, "message": "找不到这份备份"})
        info = self._summary_of(src)
        try:
            old_data = json.loads(src.read_text(encoding="utf-8")).get("data") or {}
        except (OSError, ValueError):
            old_data = {}
        if not isinstance(old_data, dict) or not old_data:
            return self._send_json({"error": -1, "message": "这份备份里没有进度数据"})

        cur = self._progress_data()
        added = 0
        restored = []
        if mode == "replace":
            data = dict(old_data)
        else:                                  # merge：只补缺，已有的国家一律不动
            data = dict(cur)
            for k, v in old_data.items():
                if not isinstance(k, str):
                    continue
                if k.startswith("found_marker_ids:") or k.startswith("hidden_cat_ids:"):
                    if str(data.get(k) or "").strip() == "" and str(v or "").strip() != "":
                        data[k] = v
                        added += 1
                        if k.startswith("found_marker_ids:"):
                            restored.append(k.split(":", 1)[1])
                elif k not in data:
                    data[k] = v

        if (json.dumps(cur, sort_keys=True, ensure_ascii=False)
                != json.dumps(data, sort_keys=True, ensure_ascii=False)):
            self._backup_current()             # 恢复前先留一份当前状态
        ROOT_DATA.mkdir(parents=True, exist_ok=True)
        saved_at, _ = self._write_progress(data)
        counts = self._summary_of(PROGRESS_FILE) or {}
        maps, markers = counts.get("maps", 0), counts.get("markers", 0)
        if mode == "replace":
            msg = f"已整份替换为 {info.get('saved_at') or name} 的备份（现 {maps} 国 / {markers} 标记）"
        elif added:
            msg = (f"已补回 {added} 条缺失记录（地图 {', '.join(restored)}）"
                   f"，现 {maps} 国 / {markers} 标记")
        else:
            msg = f"没有缺失的国家需要补回（存档未改动，现 {maps} 国 / {markers} 标记）"
        return self._send_json({"error": 0, "ok": True, "mode": mode, "added": added,
                                "restored": restored, "maps": maps, "markers": markers,
                                "saved_at": saved_at, "message": msg})

    # 安静模式：只保留真正的错误
    def log_message(self, fmt, *args):
        if str(args[1] if len(args) > 1 else "").startswith(("4", "5")):
            sys.stderr.write("  %s\n" % (fmt % args))

    def end_headers(self):
        # 本地开发用：HTML/JS/JSON 不缓存，改完代码/数据刷新即生效（瓦片/图片照旧走缓存）
        p = self.path.split("?")[0]
        if p.endswith(".html") or p.endswith(".js") or p.endswith(".json") or p == "/":
            self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    if not (WEB / "index.html").exists():
        print("[ERROR] web/index.html 不存在，目录结构不完整。")
        return 1
    ROOT_DATA.mkdir(parents=True, exist_ok=True)
    try:
        httpd = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    except OSError:
        print(f"[!] 端口 {PORT} 已被占用 —— 服务可能已经在运行。")
        print(f"    直接访问: http://127.0.0.1:{PORT}/")
        return 1
    url = f"http://127.0.0.1:{PORT}/"
    print("=" * 52)
    print("  SMO Map 本地服务已启动")
    print("=" * 52)
    print(f"  地址: {url}")
    print(f"  进度: {PROGRESS_FILE}")
    print("        （进度会自动存到这里，换浏览器/清缓存都不会丢）")
    print("  关闭此窗口即停止服务")
    print("=" * 52)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n服务已停止。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
