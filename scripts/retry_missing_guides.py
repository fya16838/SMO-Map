#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""补翻少数漏掉的条目（首批失败的 1-5 条等）。幂等：已翻过的跳过。"""
import concurrent.futures as cf
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]   # 项目根（脚本在 scripts/ 下）
sys.path.insert(0, str(ROOT / 'scripts'))
from translate_guides import clean_name, clean_text, get_key, translate_batch  # noqa: E402


def main():
    key = get_key()
    fixed = 0
    for zh_p in sorted((ROOT / 'scripts').glob('guides_*_zh.json')):
        outname = zh_p.name[len('guides_'):-len('_zh.json')]
        en_p = ROOT / 'scripts' / f'guides_{outname}.json'
        if not en_p.exists():
            continue
        ens = [r for r in json.loads(en_p.read_text(encoding='utf-8')) if len(r.get('text') or '') > 60]
        zh = json.loads(zh_p.read_text(encoding='utf-8'))
        items = []
        for r in ens:
            if str(r['num']) in zh:
                continue
            nm = clean_name(r['name'])
            tx = clean_text(r['text'], nm)
            if tx:
                items.append((str(r['num']), nm, tx))
        if not items:
            continue
        print(f'{outname}: 补翻 {len(items)} 条…', flush=True)
        batches = [items[i:i + 3] for i in range(0, len(items), 3)]
        got = {}
        with cf.ThreadPoolExecutor(max_workers=3) as ex:
            for g in ex.map(lambda b: translate_batch(b, key), batches):
                got.update(g)
        # 对仍失败的逐条重试一次
        still = [it for it in items if it[0] not in got]
        for it in still:
            got.update(translate_batch([it], key))
        zh.update(got)
        zh_p.write_text(json.dumps(zh, ensure_ascii=False, indent=1), encoding='utf-8')
        fixed += len(got)
        print(f'   → 补 {len(got)}/{len(items)}，现共 {len(zh)} 条', flush=True)
    print(f'\n补翻完成，共补 {fixed} 条')


if __name__ == '__main__':
    main()
