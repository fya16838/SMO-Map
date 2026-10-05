#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把各王国的 guides_<name>_zh.json 合并成前端用的 web/data/guides_zh.json。

结构：{ "<map-slug>": { "<编号>": {"zh":…, "name":…, "img":…} } }
map-slug 从 web/data/maps.json 的瓦片 url 模板里提取（与前端注入逻辑一致）。
"""
import html as ht
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]   # 项目根（脚本在 scripts/ 下）
WEB = ROOT / 'web'


def clean_name(nm):
    nm = ht.unescape(nm or '')
    return re.split(r'">|</|\\"|\s+[A-Z][a-z]+ Kingdom Power Moon', nm)[0].strip().strip('"')


ZH_TITLE = re.compile(r'力量之月\s*\d+\s*[-–—]')
EN_TITLE = re.compile(r'Power Moon\s*\d+\s*[-–—]')
ZH_SUMMARY = re.compile(r'是[^。]{0,14}(的|中|里)力量之月|力量之月之一|中的一颗力量之月')

# 站内嵌视频占位符 / 无意义小标题行
YT_TAG = re.compile(r'<youtube>.*?</youtube>', re.I)
NOISE_LINE = re.compile(r'^[^，。；]{0,10}(?:视频指南|视频攻略|图文攻略|返回顶部|目录)$')
# IGN 站点套话：「欢迎来到…攻略」「本页包含…的指南」
BOILER = re.compile(r'^(?:欢迎来到[^。]{0,45}(?:攻略|指南)|本页(?:包含|是)[^。]{0,80}|本篇[^。]{0,30}(?:攻略|指南))')
# 正文特征词：命中说明这行是正文而不是标题
BODY_HINT = re.compile(r'可以|找到|位于|传送|需要|进入|前往|使用|附身|踩踏|当你|如果你|你会|跳上|击败'
                       r'|区域\s*[A-Ha-h]\d')
# 标题行里的编号前缀（【21】 / 21 - / 21.）
TITLE_PREFIX = re.compile(r'^\s*(?:【(\d{1,3})】|(\d{1,3})\s*[-–—.、]?\s+)')
SENT_SPLIT = re.compile(r'(?<=[。！？!?；;])')
END_PUNCT = re.compile(r'[。！？…；;!?、,，）)]$')
# 行首「名称 + 力量之月 NN [- 名称] 是…力量之月(之一)。」整块（常与正文黏在同一行）
LEAD_TITLE_SUM = re.compile(r'^(?P<pre>.{0,80}?)力量之月\s*\d+\s*(?P<mid>.{0,140}?。)(?P<rest>.*)$')
SUM_MARK = re.compile(r'力量之月之一|中的一颗力量之月|是[^。]{0,30}力量之月')
# 行尾残留的「(X国)力量之月 NN - 名称」尾巴
TRAIL_TITLE = re.compile(r'[\u4e00-\u9fff、，]{0,8}?(?:力量之月|Power Moon)\s*\d+\s*[-–—].*$')


def _sentences(t):
    return [s.strip() for s in SENT_SPLIT.split(t or '') if s.strip()]


def _is_summary(s):
    """「库巴国力量之月 42 - XX 是…力量之月之一。」这类摘要句。"""
    return len(s) <= 90 and '力量之月' in s and (ZH_SUMMARY.search(s) or ZH_TITLE.search(s))


def _is_junk(s):
    """摘要句 / IGN 站点套话。"""
    return bool(s) and (bool(_is_summary(s)) or bool(BOILER.match(s)))


def _strip_leading_titlesum(l):
    """把行首「名称 + 力量之月 NN - 名称 + 摘要句」整块切掉（对引号、破折号混排更稳）。"""
    m = LEAD_TITLE_SUM.match(l)
    if not m:
        return l
    chunk = m.group('pre') + '力量之月' + m.group('mid')
    if len(chunk) <= 170 and SUM_MARK.search(chunk):
        return m.group('rest').strip()
    return l


def _strip_trail_title(l):
    """切掉行尾的标题尾巴（仅当它确实在行尾且后面没有正文句子时）。"""
    ms = list(TRAIL_TITLE.finditer(l))
    if not ms:
        return l
    tail = l[ms[-1].start():]
    if len(tail) <= 32 and '。' not in tail:
        return l[:ms[-1].start()].strip()
    return l


def clean_text(txt, name_en):
    """清理译文残留：

    ① `<youtube>…</youtube>` 占位符  ② 无意义小标题行（「视频指南」等）
    ③ 站点套话与「力量之月 NN - …是…力量之月之一」标题/摘要（含与正文黏成一行的情况）
    ④ 首行「标题行」（= 名称译文，短且无句末标点）——删掉，但保留【编号】前缀并入下一行
    """
    out = []
    for l in (txt or '').split('\n'):
        l = re.sub(r'\s{2,}', ' ', YT_TAG.sub(' ', l)).strip()
        if not l or NOISE_LINE.match(l):
            continue
        l = re.sub(r'^(?:视频攻略|视频指南|图文攻略|视频演示)\s+', '', l).strip()
        l = _strip_trail_title(l)                   # 行尾残留的「X国力量之月 NN - 名称」
        l = _strip_leading_titlesum(l)
        if not l:
            continue
        # ③-a 句级：去掉行首的标题/摘要/套话句（可能还黏着正文）
        sents = _sentences(l)
        while len(sents) > 1:
            s = sents[0]
            if _is_junk(s):
                del sents[0]
                continue
            # 「名称！ 库巴国力量之月 16 - 名称是…」：摘要句前紧邻的短名称句一并去掉
            if len(s) <= 22 and not BODY_HINT.search(s) and _is_junk(sents[1]):
                del sents[0]
                continue
            break
        if len(sents) == 1 and _is_junk(sents[0]):
            continue                                  # 整行就是标题/摘要/套话 → 丢弃
        l = ''.join(sents).strip()
        if not l:
            continue
        if len(l) < 130 and (EN_TITLE.search(l) or ZH_TITLE.search(l)):
            continue
        if len(l) < 130 and ZH_SUMMARY.search(l):
            continue
        if name_en and l.startswith(name_en) and len(l) < 90:
            continue
        out.append(l)
    if not out:
        return ''

    # ④ 首行整行是标题行（= 名称译文）：删掉，保留【编号】前缀
    if len(out) >= 2:
        f = out[0]
        if len(f) <= 45 and not END_PUNCT.search(f) and not BODY_HINT.search(f):
            m = TITLE_PREFIX.match(f)
            rest = out[1:]
            if m:
                rest[0] = '【%d】%s' % (int(m.group(1) or m.group(2)), rest[0])
            out = rest
    return '\n'.join(x for x in out if x)


def main():
    maps = json.loads((WEB / 'data' / 'maps.json').read_text(encoding='utf-8'))['data']
    slug_by_name = {}
    for m in maps:
        layers = m.get('m_tile_layers') or [{}]
        parts = (layers[0].get('url_template') or '').split('/')
        i = parts.index('map') if 'map' in parts else -1
        if i >= 0:
            slug_by_name[m['name']] = (parts[i + 1], m['map_id'])

    out, stats = {}, []
    for p in sorted((ROOT / 'scripts').glob('guides_*_zh.json')):
        outname = p.name[len('guides_'):-len('_zh.json')]
        if outname == 'cap':
            outname = 'cap'
        # 英文原件用来取 name / img
        en_p = ROOT / 'scripts' / f'guides_{outname}.json'
        en = {}
        if en_p.exists():
            for r in json.loads(en_p.read_text(encoding='utf-8')):
                en[str(r['num'])] = r
        zh = json.loads(p.read_text(encoding='utf-8'))

        # 找出这个 outname 对应哪个王国：用英文原件的 kingdom 字段
        kingdom = None
        if en:
            kingdom = next(iter(en.values())).get('kingdom')
        if not kingdom or kingdom not in slug_by_name:
            # 回退：用文件名猜
            guess = outname.replace('-', ' ').title()
            kingdom = next((k for k in slug_by_name if k.lower().replace("'", '') == guess.lower().replace("'", '')), None)
        if not kingdom:
            print(f'  跳过 {p.name}（无法确定王国）')
            continue

        slug, mid = slug_by_name[kingdom]
        bucket = out.setdefault(slug, {})
        for num, txt in zh.items():
            e = en.get(str(num), {})
            nm = clean_name(e.get('name'))
            t = clean_text(txt, nm)
            if t:
                bucket[str(int(num))] = {'zh': t, 'name': nm, 'img': e.get('image')}
        stats.append((kingdom, slug, len(bucket)))

    (WEB / 'data' / 'guides_zh.json').write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
    total = sum(len(v) for v in out.values())
    print(f'✅ web/data/guides_zh.json：{len(out)} 张地图 / {total} 条')
    for kingdom, slug, n in sorted(stats, key=lambda x: -x[2]):
        print(f'   {kingdom:<20} {slug:<20} {n:>3} 条')
    size = (WEB / 'data' / 'guides_zh.json').stat().st_size
    print(f'   文件大小：{size/1024:.0f} KB')


if __name__ == '__main__':
    main()
