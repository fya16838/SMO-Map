#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""批量抓取全部王国的力量之月攻略（复用 fetch_moon_guides 的抓取逻辑）。

产出 scripts/guides_<outname>.json（每王国一个，供后续翻译合并）。
"""
import concurrent.futures as cf
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from fetch_moon_guides import ROOT, WIKI_SLUG, clean_name, work  # noqa: E402

OUT = {'Cap Kingdom': 'cap'}  # 帽子国已完成，跳过


def main():
    lists = json.loads((ROOT / 'scripts' / 'wiki_moon_lists.json').read_text(encoding='utf-8'))
    tasks, meta = [], {}
    for kingdom, wslug in WIKI_SLUG.items():
        outname = OUT.get(kingdom) or kingdom.lower().replace(' ', '-').replace("'", '')
        if outname in OUT.values():
            print(f'跳过（已完成）: {kingdom}', flush=True)
            continue
        # 名称清洗（清单里可能有历史遗留的 HTML 尾巴）
        moons = {}
        for n, nm in (lists.get(kingdom) or {}).items():
            c = clean_name(nm)
            if c:
                moons[n] = c
        meta[outname] = (kingdom, wslug, moons)
        for n, nm in moons.items():
            tasks.append((kingdom, wslug, n, nm))

    # ---- 断点续传：读已有结果，只补缺失的 ----
    done_map = {}
    for outname in meta:
        fp = ROOT / 'scripts' / f'guides_{outname}.json'
        if fp.exists():
            try:
                for r in json.loads(fp.read_text(encoding='utf-8')):
                    if len(r.get('text') or '') > 60:
                        done_map.setdefault(r['kingdom'], {})[int(r['num'])] = r
            except Exception:
                pass
    results = {k: list(v.values()) for k, v in done_map.items()}
    tasks = [x for x in tasks if int(x[2]) not in done_map.get(x[0], {})]
    print(f'已完成(跳过) {sum(len(v) for v in done_map.values())} 条；待抓 {len(tasks)} 条，3 线程低并发防限流…', flush=True)
    with cf.ThreadPoolExecutor(max_workers=2) as ex:
        for r in ex.map(work, tasks):
            results.setdefault(r['kingdom'], []).append(r)

    total_ok = 0
    for outname, (kingdom, wslug, moons) in meta.items():
        rows = sorted(results.get(kingdom, []), key=lambda x: x['num'])
        ok = [r for r in rows if len(r.get('text') or '') > 60]
        total_ok += len(ok)
        p = ROOT / 'scripts' / f'guides_{outname}.json'
        p.write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding='utf-8')
        print(f'{kingdom:<20} {len(ok):>3}/{len(rows):>3}  → scripts/guides_{outname}.json', flush=True)

    print(f'\n总计成功 {total_ok} / {len(tasks)}', flush=True)


if __name__ == '__main__':
    main()
