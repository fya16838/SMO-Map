#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""并发从 IGN wiki 抓取缺失月亮坐标（v2：8 线程并发）。

坐标变换（6 个王国回归，平均误差 ~0.8 单位）：
    local_lat = 252.9402 * ign_lat - 1.8380
    local_lng = 256.3773 * ign_lng - 0.2042
"""
import concurrent.futures as cf
import json
import pathlib
import re
import sys
import urllib.request

HDR = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0.0.0 Safari/537.36'}
ROOT = pathlib.Path(__file__).resolve().parents[1]   # 项目根（脚本在 scripts/ 下）
A_LAT, B_LAT = 252.9402, -1.8380
A_LNG, B_LNG = 256.3773, -0.2042
BASE = 'https://www.ign.com/wikis/super-mario-odyssey/'


def build_url(wslug, num, name):
    s = name.replace(' ', '_').replace('&', 'and')
    s = re.sub(r"[^A-Za-z0-9_'\-]", '', s)
    return f'{BASE}{wslug}_Power_Moon_{int(num):02d}_-_{s}'


def work(item):
    kingdom, wslug, num, name = item
    url = build_url(wslug, num, name)
    for attempt in range(2):
        try:
            h = urllib.request.urlopen(urllib.request.Request(url, headers=HDR), timeout=15).read().decode('utf-8', 'replace')
            lat = re.search(r'"lat"\s*:\s*(-?[\d.]+)', h)
            lng = re.search(r'"lng"\s*:\s*(-?[\d.]+)', h)
            if lat and lng:
                ilat, ilng = float(lat.group(1)), float(lng.group(1))
                return {'kingdom': kingdom, 'num': int(num), 'name': name,
                        'ign_lat': ilat, 'ign_lng': ilng,
                        'lat': round(A_LAT * ilat + B_LAT, 2),
                        'lng': round(A_LNG * ilng + B_LNG, 2)}
            return {'kingdom': kingdom, 'num': int(num), 'name': name, 'fail': '无坐标字段', 'url': url}
        except Exception as e:
            if attempt == 0:
                continue
            return {'kingdom': kingdom, 'num': int(num), 'name': name, 'fail': str(e)[:60], 'url': url}
    return {'kingdom': kingdom, 'num': int(num), 'name': name, 'fail': 'unknown', 'url': url}


def main():
    mis = json.loads((ROOT / 'scripts' / 'wiki_missing.json').read_text(encoding='utf-8'))
    items = []
    for kingdom, d in mis.items():
        for num, name in sorted(d['missing'].items(), key=lambda x: int(x[0])):
            items.append((kingdom, d['wslug'], num, name))
    print(f'共 {len(items)} 个缺失项，8 线程并发抓取...', flush=True)

    results, done = [], 0
    with cf.ThreadPoolExecutor(max_workers=8) as ex:
        for r in ex.map(work, items):
            done += 1
            results.append(r)
            tag = 'OK  ' if 'lat' in r else 'FAIL'
            print(f'[{done}/{len(items)}] {tag} {r["kingdom"]:<18} #{r["num"]:>3} {r["name"][:44]}', flush=True)

    ok = [r for r in results if 'lat' in r]
    fails = [r for r in results if 'lat' not in r]
    out = {}
    for r in ok:
        out.setdefault(r['kingdom'], []).append({k: v for k, v in r.items() if k != 'kingdom'})
    (ROOT / 'scripts' / 'missing_coords.json').write_text(
        json.dumps({'coords': out, 'fails': fails}, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'\n完成: 成功 {len(ok)} / 失败 {len(fails)}', flush=True)
    if fails:
        print('失败清单:', flush=True)
        for f in fails[:20]:
            print(f'   {f["kingdom"]} #{f["num"]} {f["name"][:40]} ← {f.get("fail")}', flush=True)


if __name__ == '__main__':
    main()
