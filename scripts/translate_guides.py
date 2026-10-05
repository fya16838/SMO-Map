#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把 guides_<name>.json（英文攻略）翻译成中文，产出 guides_<name>_zh.json。

用法: python translate_guides.py <outname> [<outname2> ...]
并发 3 批 × 每批 5 条；deepseek-flash 是推理模型，max_tokens 必须给足。
"""
import concurrent.futures as cf
import html as ht
import json
import os
import pathlib
import re
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]   # 项目根（脚本在 scripts/ 下）
TERMS = """术语：Power Moon=力量之月; Multi Moon=崇高之月; Odyssey=奥德赛号; Bonneton=邦尼顿;
Cap Kingdom=帽子国; Cascade Kingdom=瀑布国; Sand Kingdom=沙之国; Lake Kingdom=湖之国;
Wooded Kingdom=森之国; Cloud Kingdom=云之国; Lost Kingdom=遗失王国; Metro Kingdom=都市国;
Snow Kingdom=雪之国; Seaside Kingdom=海之国; Luncheon Kingdom=料理国; Ruined Kingdom=被夺之国;
Bowser's Kingdom=库巴国; Moon Kingdom=月之国; Dark Side=月之国背面; Mushroom Kingdom=蘑菇王国;
New Donk City=纽敦市; Tostarena=托斯塔雷纳; Steam Gardens=蒸汽花园; Mount Volbono=火山之国;
Quadrant=区域; frog=青蛙; hat platform=帽子平台; fog=迷雾; coin=金币; Boss=头目;
Crazy Cap=疯狂帽子商店; Bullet Bill=子弹比尔; spark pylon=电线; moon rock=月之石;
Note=音符; checkpoint flag=检查点旗帜; Goomba=栗子小子; hat trampoline=帽子蹦床; Talkatoo=话痨鹦鹉;
Cappy=凯皮; capture=附身; Ground Pound=踩踏; purple coin=紫币; warp painting=传送画框;
Hint Art=提示画; Timer Challenge=计时挑战; Koopa Freerunning=慢慢龟赛跑; Jaxi=加西;
Sherm=谢尔姆; Gushen=喷水龟; Glydon=滑翔龙; Lakitu=云龟; Yoshi=耀西; Toadette=奇诺比珂"""


def clean_name(nm):
    nm = ht.unescape(nm or '')
    return re.split(r'">|</|\\"|\s+[A-Z][a-z]+ Kingdom Power Moon', nm)[0].strip().strip('"')


def clean_text(txt, name_en):
    out = []
    for l in (txt or '').split('\n'):
        l = l.strip()
        if not l:
            continue
        if re.search(r'Power Moon\s*\d+\s*-\s*', l) and len(l) < 80:
            continue
        if name_en and l.startswith(name_en) and len(l) < 90:
            continue
        out.append(l)
    return '\n'.join(out)


def get_key():
    for k in list(os.environ):
        if 'proxy' in k.lower():
            del os.environ[k]
    env = pathlib.Path(r'D:\Hermes\hermes\.env').read_text(encoding='utf-8', errors='replace')
    return re.search(r'DEEPSEEK_API_KEY\s*=\s*["\']?([^"\'\r\n]+)', env).group(1).strip()


def translate_batch(payload_items, key):
    payload = '\n\n'.join(f'【{n}】{nm}\n{t}' for n, nm, t in payload_items)
    prompt = (f"把下面《超级马力欧 奥德赛》力量之月攻略翻译成简体中文。{TERMS}\n"
              "要求：用上面术语；数字保留；保持分句结构（玩家要按步骤操作，不要合并句子）；"
              '输出 JSON，键是关卡编号（纯数字字符串），值是中文翻译，不要任何其他文字。\n\n' + payload)
    body = json.dumps({'model': 'deepseek-flash', 'messages': [{'role': 'user', 'content': prompt}],
                       'temperature': 0.3, 'max_tokens': 16000}).encode()
    req = urllib.request.Request('https://api.deepseek.com/chat/completions', data=body,
                                 headers={'Content-Type': 'application/json',
                                          'Authorization': f'Bearer {key}'})
    r = json.loads(urllib.request.urlopen(req, timeout=900).read().decode())
    txt = r['choices'][0]['message'].get('content') or ''
    m = re.search(r'\{[\s\S]*\}', txt)
    if not m:
        return {}
    got = json.loads(m.group(0))
    return {k: v for k, v in got.items() if re.fullmatch(r'\d+', str(k))}


def main():
    names = sys.argv[1:]
    if not names:
        print('用法: translate_guides.py <outname> [...]'); return
    key = get_key()
    for name in names:
        src = ROOT / 'scripts' / f'guides_{name}.json'
        if not src.exists():
            print(f'{name}: 文件不存在，跳过'); continue
        rows = json.loads(src.read_text(encoding='utf-8'))
        items = []
        for r in rows:
            if len(r.get('text') or '') > 60:
                nm = clean_name(r['name'])
                tx = clean_text(r['text'], nm)
                if tx:
                    items.append((str(r['num']), nm, tx))
        if not items:
            print(f'{name}: 无可翻译内容'); continue

        batches = [items[i:i + 5] for i in range(0, len(items), 5)]
        out = {}
        with cf.ThreadPoolExecutor(max_workers=3) as ex:
            for got in ex.map(lambda b: translate_batch(b, key), batches):
                out.update(got)
        p = ROOT / 'scripts' / f'guides_{name}_zh.json'
        p.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
        print(f'{name}: {len(out)}/{len(items)} 条 → {p.name}', flush=True)
    print('done')


if __name__ == '__main__':
    main()
