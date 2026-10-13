#!/usr/bin/env python3
"""にゃんこ大戦争 ガチャシード検索ツールのビルド

godfat/battle-cats-rolls (Apache-2.0) が公開している日本版データ build/bc-jp.yaml を
コンパクトな JSON に変換し、src/template.html と src/core.js と合わせて
単一ファイルの index.html を生成します。

  python3 build.py            # 手元の bc-jp.yaml (data/bc-jp.yaml) を使う
  python3 build.py --fetch    # 最新の bc-jp.yaml を GitLab から取得してから生成
"""
import json
import os
import re
import sys
import urllib.request

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
YAML_URL = 'https://gitlab.com/godfat/battle-cats-rolls/-/raw/master/build/bc-jp.yaml'
YAML_PATH = os.path.join(HERE, 'data', 'bc-jp.yaml')

EVENTS_SINCE = '2024-01-01'


def fetch():
    os.makedirs(os.path.dirname(YAML_PATH), exist_ok=True)
    print('downloading', YAML_URL, file=sys.stderr)
    with urllib.request.urlopen(YAML_URL, timeout=120) as r, open(YAML_PATH, 'wb') as f:
        f.write(r.read())


def convert(doc):
    cats = {}
    for cid, c in doc['cats'].items():
        names = [n for n in (c.get('name') or []) if n]
        cats[int(cid)] = [c.get('rarity', 0), names]

    # コラボ判定: キャラ説明の「○○から参戦」「コラボ」や、ガチャ/イベント名の「コラボ」から判断する
    collab_title_of = {}
    for cid, c in doc['cats'].items():
        descs = ' '.join(x for x in (c.get('desc') or []) if x)
        m = re.search(r'[「『]([^」』]+)[」』](?:シリーズ)?(?:より|から)(?:の|神さまの力で)?参戦', descs) \
            or re.search(r'^([^「」『』！!。、]{2,40}?)(?:シリーズ)?(?:より|から)(?:の|神さまの力で)?参戦', descs) \
            or re.search(r'[「『]?([^\s「」『』]+?)[」』]?に登場するキャラクター[\s　]*コラボ', descs)
        if m:
            collab_title_of[cid] = m.group(1)
        elif 'コラボ' in descs and c.get('rarity', 0) >= 4:
            collab_title_of[cid] = ''
    names_of_gacha = {}
    for e in doc['events'].values():
        names_of_gacha.setdefault(e['id'], []).append(e.get('name') or '')

    gacha = {}
    for gid, g in doc['gacha'].items():
        entry = {'c': list(g.get('cats') or [])}
        ubers = [i for i in entry['c'] if i in doc['cats'] and doc['cats'][i].get('rarity', 0) >= 4]
        hits = [collab_title_of[i] for i in ubers if i in collab_title_of]
        names = names_of_gacha.get(gid, []) + [g.get('name') or '']
        by_name = any('コラボ' in n for n in names)
        if (ubers and len(hits) * 2 >= len(ubers)) or by_name:
            # 作品名はキャラ説明文から取るのを優先(ガチャ名の「」はキャラ名のことが多い)
            # 一番新しいキャラ(ID が大きい)の作品名を使う(同じ作品でも表記が新しくなることがある)
            named = [(i, collab_title_of[i]) for i in sorted(ubers, reverse=True) if collab_title_of.get(i)]
            title = named[0][1] if named else ''
            if not title:
                for n in names:
                    mm = re.search(r'[「『]([^」』]+)[」』]', n)
                    if mm and 'コラボ' in n:
                        title = mm.group(1)
                        break
            entry['x'] = title or 'コラボ'
        if g.get('name'):
            entry['n'] = g['name']
        if g.get('rate'):
            entry['r'] = g['rate']
        if g.get('series_id') is not None:
            entry['s'] = g['series_id']
        gacha[int(gid)] = entry

    # godfat の CrystalBall#noramlize_end_date_by_series_id! と同じく、同じシリーズの
    # 次のイベントが始まった時点で前のイベントは終わったものとして終了日を詰める
    series_to_event = {}
    ends = {}
    for key, e in doc['events'].items():
        ends[key] = e['end_on']
        series_id = (doc['gacha'].get(e['id']) or {}).get('series_id')
        earlier = series_to_event.get(series_id)
        if earlier is not None and e['start_on'] < ends[earlier]:
            ends[earlier] = e['start_on']
        series_to_event[series_id] = key

    events = []
    for key, e in doc['events'].items():
        if e['start_on'].isoformat() < EVENTS_SINCE:
            continue  # 古いイベントはファイルサイズ節約のため省く(ガチャ自体はカスタムで選べる)
        g = 11 if e.get('guaranteed') else 15 if e.get('step_up') else 0
        events.append({
            'k': key, 'id': e['id'],
            's': e['start_on'].isoformat(), 'e': ends[key].isoformat(),
            'rare': e.get('rare', 0), 'supa': e.get('supa', 0), 'uber': e.get('uber', 0),
            'legend': e.get('legend', 0), 'g': g,
            'p': e.get('platinum') or '', 'n': e.get('name', ''),
        })
    events.sort(key=lambda x: (x['s'], x['k']))
    return {'cats': cats, 'gacha': gacha, 'events': events}


def main():
    if '--fetch' in sys.argv or not os.path.exists(YAML_PATH):
        fetch()
    with open(YAML_PATH, encoding='utf8') as f:
        doc = yaml.safe_load(f)
    data = convert(doc)
    with open(os.path.join(HERE, 'src', 'core.js'), encoding='utf8') as f:
        core = f.read()
    with open(os.path.join(HERE, 'src', 'template.html'), encoding='utf8') as f:
        tpl = f.read()
    data_js = 'var DATA = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';'
    # </script> がデータ内に現れても壊れないようにする
    data_js = data_js.replace('</', '<\\/')
    core = core.replace('</', '<\\/')
    out = tpl.replace('/*__CORE__*/', core).replace('/*__DATA__*/', data_js)
    out = out.replace('__BUILT__', __import__('datetime').date.today().isoformat())
    with open(os.path.join(HERE, 'index.html'), 'w', encoding='utf8') as f:
        f.write(out)
    print('cats %d, gacha %d, events %d, index.html %d bytes' % (
        len(data['cats']), len(data['gacha']), len(data['events']), len(out.encode('utf8'))), file=sys.stderr)


if __name__ == '__main__':
    main()
