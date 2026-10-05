#!/usr/bin/env python3
"""Download all SMO map tiles locally (16 maps x 336 tiles)."""
import json, pathlib, urllib.request, concurrent.futures as cf, sys, time

WEB = pathlib.Path(__file__).resolve().parent.parent / 'web'
BASE = 'https://smo.game-maps.info'
HDR = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0.0.0 Safari/537.36'}


def fetch_png(url):
    req = urllib.request.Request(url, headers=HDR)
    with urllib.request.urlopen(req, timeout=25) as r:
        return r.read()


def main():
    maps = json.loads((WEB / 'data/maps.json').read_text(encoding='utf-8'))['data']
    jobs = []
    for m in maps:
        tpl = m['m_tile_layers'][0]['url_template']      # /map/<slug>/{z}/{x}-{y}.png
        slug = tpl.split('/')[2]
        for z in range(m['min_zoom'], m['max_zoom'] + 1):
            n = 2 ** (z - 2) * 4 // 4                     # z2 -> 4, z3 -> 8, z4 -> 16
            n = {2: 4, 3: 8, 4: 16}.get(z, 4)
            for x in range(n):
                for y in range(n):
                    jobs.append((slug, z, x, y))

    total = len(jobs)
    print(f'待下载瓦片: {total} 张 ({len(maps)} 地图)', flush=True)
    stat = {'ok': 0, 'skip': 0, 'fail': 0, 'bytes': 0}
    fails = []

    def work(job):
        slug, z, x, y = job
        dest = WEB / 'map' / slug / str(z) / f'{x}-{y}.png'
        if dest.exists() and dest.stat().st_size > 0:
            stat['skip'] += 1
            return
        url = f'{BASE}/map/{slug}/{z}/{x}-{y}.png'
        try:
            data = fetch_png(url)
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
            stat['ok'] += 1
            stat['bytes'] += len(data)
        except urllib.error.HTTPError as e:
            stat['fail'] += 1
            fails.append(f'{url} -> HTTP {e.code}')
        except Exception as e:
            stat['fail'] += 1
            fails.append(f'{url} -> {type(e).__name__}')

    t0 = time.time()
    with cf.ThreadPoolExecutor(max_workers=12) as ex:
        for i, _ in enumerate(ex.map(work, jobs), 1):
            if i % 500 == 0:
                print(f'  进度 {i}/{total}  (ok={stat["ok"]} skip={stat["skip"]} fail={stat["fail"]})', flush=True)

    dt = time.time() - t0
    print(f'\n完成: ok={stat["ok"]} skip={stat["skip"]} fail={stat["fail"]} '
          f'新增 {stat["bytes"]/1024/1024:.1f} MB | 用时 {dt:.0f}s', flush=True)
    if fails:
        print(f'失败样例 ({len(fails)}):', flush=True)
        for f in fails[:10]:
            print('  ', f, flush=True)

    # 统计落盘总量
    tiles = list((WEB / 'map').rglob('*.png'))
    sz = sum(t.stat().st_size for t in tiles)
    print(f'\n本地瓦片: {len(tiles)} 张, {sz/1024/1024:.1f} MB', flush=True)


if __name__ == '__main__':
    main()
