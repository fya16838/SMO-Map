#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""抓取指定王国所有力量之月的 IGN wiki 详情页 → 提取英文攻略正文 + 配图。

用法: python fetch_moon_guides.py <WikiSlug> [输出名]
例:   python fetch_moon_guides.py Cap_Kingdom cap
"""
import concurrent.futures as cf
import html as ht
import json
import pathlib
import random
import re
import sys
import time
import urllib.error
import urllib.request

HDR = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0.0.0 Safari/537.36'}
ROOT = pathlib.Path(__file__).resolve().parents[1]   # 项目根（脚本在 scripts/ 下）
BASE = 'https://www.ign.com/wikis/super-mario-odyssey/'
WIKI_SLUG = {'Cap Kingdom': 'Cap_Kingdom', 'Cascade Kingdom': 'Cascade_Kingdom', 'Sand Kingdom': 'Sand_Kingdom',
             'Lake Kingdom': 'Lake_Kingdom', 'Wooded Kingdom': 'Wooded_Kingdom', 'Cloud Kingdom': 'Cloud_Kingdom',
             'Lost Kingdom': 'Lost_Kingdom', 'Metro Kingdom': 'Metro_Kingdom', 'Snow Kingdom': 'Snow_Kingdom',
             'Seaside Kingdom': 'Seaside_Kingdom', 'Luncheon Kingdom': 'Luncheon_Kingdom',
             'Ruined Kingdom': 'Ruined_Kingdom', "Bowser's Kingdom": "Bowser's_Kingdom",
             'Moon Kingdom': 'Moon_Kingdom', 'Dark Side': 'Dark_Side', 'Mushroom Kingdom': 'Mushroom_Kingdom'}


def clean_name(nm):
    """wiki 列表里抓来的名称可能粘了 HTML 尾巴，先切干净。"""
    nm = ht.unescape(nm or '')
    nm = re.split(r'">|</|\\"|\s+Cap Kingdom Power Moon', nm)[0]
    return nm.strip().strip('"').strip()


def build_url_variants(wslug, num, name):
    """IGN 的 URL 对特殊字符的处理不统一，生成多个候选依次尝试。"""
    from urllib.parse import quote
    base = f'{BASE}{wslug}_Power_Moon_{int(num):02d}_-_'
    s = name.replace(' ', '_').replace('&', 'and')
    out = [base + s, base + quote(s, safe='_'),
           base + re.sub(r"[^A-Za-z0-9_'\-]", '', s)]
    # 去重保序
    seen, uniq = set(), []
    for u in out:
        if u not in seen:
            seen.add(u); uniq.append(u)
    return uniq


def body_of(h):
    """从页面 HTML 提取攻略正文（英文）。"""
    t = re.sub(r'<script[\s\S]*?</script>', ' ', h)
    t = re.sub(r'<style[\s\S]*?</style>', ' ', t)
    t = ht.unescape(re.sub(r'<[^>]+>', ' ', t))
    t = re.sub(r'[ \t\xa0]+', ' ', t)
    i = t.find('View Interactive Map')
    if i < 0:
        i = t.find('Interactive Map')
    j = t.find('Up Next:', i if i > 0 else 0)
    if j < 0:
        j = len(t)
    seg = t[i + 20:j].strip() if i > 0 else t[:j].strip()
    # 去掉开头的 "Add IGN on Google" 之类
    seg = re.sub(r'^(Add IGN on Google\s*)?', '', seg)
    return seg.strip()


def work(item):
    """抓一个月亮。区分 404（真没有）与 429（限流，退避重试）。"""
    kingdom, wslug, num, name = item
    name = clean_name(name)
    time.sleep(0.3 + random.random() * 0.4)      # jitter：打散发请求节奏，降低触发限流的概率
    last = ''
    for attempt in range(4):
        h = None
        variants = build_url_variants(wslug, num, name)
        for url in variants:
            try:
                h = urllib.request.urlopen(urllib.request.Request(url, headers=HDR), timeout=25).read().decode('utf-8', 'replace')
                break
            except urllib.error.HTTPError as e:
                if e.code == 429:
                    last = 'HTTP 429 限流'
                    time.sleep(15 * (attempt + 1))          # 15/30/45/60 秒退避
                    break                                    # 跳出 URL 循环，重来一轮
                last = f'HTTP {e.code}'
                continue
            except Exception as e:
                last = type(e).__name__
                continue
        if h is None:
            if last and last.startswith('HTTP 429'):
                continue                                     # 已被限流，重试
            if attempt >= 1:
                return {'kingdom': kingdom, 'num': int(num), 'name': name, 'text': '', 'error': last or 'all URL variants 404'}
            continue
        try:
            img = re.search(r'"image"\s*:\s*"(https://[^"]+?\.(?:jpg|jpeg|png))"', h)
            coords = re.search(r'"lat"\s*:\s*(-?[\d.]+)\s*,\s*"lng"\s*:\s*(-?[\d.]+)', h)
            body = body_of(h)
            return {'kingdom': kingdom, 'num': int(num), 'name': name,
                    'text': body, 'image': img.group(1) if img else None,
                    'ign_lat': float(coords.group(1)) if coords else None,
                    'ign_lng': float(coords.group(2)) if coords else None}
        except Exception as e:
            return {'kingdom': kingdom, 'num': int(num), 'name': name, 'text': '', 'error': last or str(e)[:70]}
    return {'kingdom': kingdom, 'num': int(num), 'name': name, 'text': '', 'error': 'unknown'}


def main():
    wslug = sys.argv[1] if len(sys.argv) > 1 else 'Cap_Kingdom'
    outname = sys.argv[2] if len(sys.argv) > 2 else wslug.lower()
    kings = {v: k for k, v in WIKI_SLUG.items()}
    kingdom = kings.get(wslug, wslug.replace('_', ' '))
    lists = json.loads((ROOT / 'scripts' / 'wiki_moon_lists.json').read_text(encoding='utf-8'))
    moons = lists.get(kingdom, {})
    # 顺手把清洗后的名称写回清单（一次性修数据）
    cleaned = {k: clean_name(v) for k, v in moons.items()}
    if cleaned != moons:
        lists[kingdom] = cleaned
        (ROOT / 'scripts' / 'wiki_moon_lists.json').write_text(
            json.dumps(lists, ensure_ascii=False, indent=1), encoding='utf-8')
        print('已修正 wiki_moon_lists.json 中的名称尾巴')
    items = [(kingdom, wslug, n, nm) for n, nm in sorted(cleaned.items(), key=lambda x: int(x[0])) if nm]
    print(f'{kingdom}: {len(items)} 个月亮，8 线程抓取…', flush=True)

    res = []
    with cf.ThreadPoolExecutor(max_workers=8) as ex:
        for r in ex.map(work, items):
            res.append(r)
            n = len(r.get('text') or '')
            print(f'  #{r["num"]:>3} {"OK " if n > 60 else "FAIL"} {n:>5} chars  {r["name"][:44]}', flush=True)

    good = [r for r in res if len(r.get('text') or '') > 60]
    out = ROOT / 'scripts' / f'guides_{outname}.json'
    out.write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'\n成功 {len(good)}/{len(res)}，已保存 {out.name}')


if __name__ == '__main__':
    main()
