import json,sys,statistics
for f in sys.argv[1:]:
  r=json.load(open(f))['results']
  for v in sorted({x['variant'] for x in r}):
    for item in ('death','joint'):
      xs=[x for x in r if x['variant']==v and x['item']==item]
      nums=[x.get('probability') for x in xs if x['format']=='numeric']
      cats=[x.get('verdict') for x in xs if x['format']=='categorical']
      byw={}
      for x in xs:
        if x['format']=='numeric': byw.setdefault(x['wording'],[]).append(x.get('probability'))
      ok=[n for n in nums if n is not None]
      print(f"{f.split('/')[-1]:20} {v:12} {item:5} n={len(ok):2} high(>=67)={sum(n>=67 for n in ok)}/{len(ok)} med={statistics.median(ok) if ok else None} byWording={byw} verdicts={cats}")
