import json, numpy as np, sys
from collections import defaultdict
P = sys.argv[1] + '/bt.jsonl'
R = [json.loads(l) for l in open(P)]
H = 25
print('obs', len(R), 'con fundamental', sum(1 for r in R if r['F']))
rng = np.random.default_rng(1)
z = rng.standard_normal(2_000_000); KS, AN = 0.84, 0.5
cred = np.minimum(np.maximum(np.abs(z) - KS, 0), AN).mean()
d = np.array([r['d'] for r in R]); fechas = np.unique(d); fi = np.searchsorted(fechas, d)
hv = np.array([r['hv'] for r in R]); hv60 = np.array([r['hv60'] or r['hv'] for r in R])
sig = np.sqrt(hv * hv60) * np.sqrt(H / 252)          # volatilidad esperada: media geométrica HV20/HV60 (no hay IV histórica)
x = np.clip(np.array([r['ret'] for r in R]) / sig, -6, 6)
PL = {'C': np.maximum(x, 0) - 0.3989, 'P': np.maximum(-x, 0) - 0.3989, 'I': cred - np.minimum(np.maximum(np.abs(x) - KS, 0), AN)}
print('P/L medio por estrategia (unidades de sigma):', {k: round(float(v.mean()), 3) for k, v in PL.items()}, 'IC gana', round(float((np.abs(x) < KS).mean()), 3))
def prep(cs):
    s = np.array([[r[c][0] if r[c] else np.nan for c in cs] for r in R]); e = np.array([[r[c][1] if r[c] else 0.0 for c in cs] for r in R]); e = np.where(np.isnan(s), 0, e); s0 = np.nan_to_num(s)
    S = e.sum(1); ok = S > 0; Sx = np.where(ok, S, 1)
    m = (e * s0).sum(1) / Sx; D = np.sqrt((e * (s0 - m[:, None]) ** 2).sum(1) / Sx); A = np.clip(1 - D, 0, 1); N = (e * (1 - np.abs(s0))).sum(1) / Sx
    return m, A, N, S / len(cs), ok
def viejo(m, A, N, C): return {'C': 50 + 50 * m * A, 'P': 50 - 50 * m * A, 'I': 100 * N}
def nuevo(m, A, N, C):
    Rz = np.sqrt(C); return {'C': np.clip(50 + 50 * m * A * Rz, 0, 100), 'P': np.clip(50 - 50 * m * A * Rz, 0, 100), 'I': np.clip(50 + 125 * (N - .6) * A * Rz, 0, 100)}
def rank(a): return np.argsort(np.argsort(a))
def ic(score, pl, mask):
    v = []
    for k in range(len(fechas)):
        q = (fi == k) & mask
        if q.sum() > 50 and np.std(score[q]) > 0: v.append(np.corrcoef(rank(score[q]), rank(pl[q]))[0, 1])
    v = np.array(v); return v.mean(), v.mean() / (v.std(ddof=1) / np.sqrt(len(v)))
def porfecha(val, mask):
    v = np.array([val[(fi == k) & mask].mean() for k in range(len(fechas)) if ((fi == k) & mask).sum() >= 5]); return v.mean(), v.mean() / (v.std(ddof=1) / np.sqrt(len(v))), len(v)
dem = {k: v - v.mean() for k, v in PL.items()}
E = ['C', 'P', 'I']; M = np.stack([dem[k] for k in E], 1)
for nombre, cs in [('tecnico+indicadores', ['T', 'I']), ('+fundamental', ['T', 'I', 'F'])]:
    m, A, N, C, ok = prep(cs)
    if 'F' in cs: ok = ok & np.array([bool(r['F']) for r in R])
    print('\n=====', nombre, 'obs', ok.sum())
    for per, pm in [('2018-2022', d < '2023'), ('2023-2026', d >= '2023')]:
        mk = ok & pm; print('--', per, mk.sum())
        for nf, f in [('actual', viejo), ('propuesta', nuevo)]:
            sc = f(m, A, N, C)
            print(nf.ljust(10), 'corr ranking-resultado:', ' '.join(f"{k} {ic(sc[k], PL[k], mk)[0]:+.3f}(t{ic(sc[k], PL[k], mk)[1]:+.1f})" for k in E))
            T = np.stack([sc[k] for k in E], 1); el = T.argmax(1); best = T.max(1); g = M[np.arange(len(el)), el]
            a = porfecha(g, mk); b = porfecha(g, mk & (best >= 60))
            print(' ' * 10, f"elegida: reparto C/P/I {[round(float((el[mk]==i).mean()),2) for i in range(3)]} ventaja {a[0]:+.3f} (t {a[1]:+.1f}); con >=60 ({(mk&(best>=60)).sum()}): {b[0]:+.3f} (t {b[1]:+.1f})")
            for i, k in enumerate(E):
                q = mk & (el == i) & (best >= 60)
                if q.sum() > 200:
                    gana = {'C': x > .3989, 'P': x < -.3989, 'I': np.abs(x) < KS}[k]; c = porfecha(dem[k], q)
                    print(' ' * 12, k, 'n', q.sum(), f"acierto {gana[q].mean():.3f} vs base {gana[mk].mean():.3f}; ventaja {c[0]:+.3f} (t {c[1]:+.1f})")
# ¿La neutralidad predice quietud? y ¿el "peleado" se comporta como lateral?
m, A, N, C, ok = prep(['T', 'I'])
q = np.quantile(N, [0, .2, .4, .6, .8, 1]); print('\nneutralidad (quintil) -> |x| medio, dentro de 0.84s:', [(round(float(np.abs(x[(N >= a) & (N <= b)]).mean()), 3), round(float((np.abs(x[(N >= a) & (N <= b)]) < KS).mean()), 3)) for a, b in zip(q[:-1], q[1:])], 'mediana N', round(float(np.median(N)), 3))
q = np.quantile(m, [0, .2, .4, .6, .8, 1]); print('sesgo (quintil) -> x medio:', [round(float(x[(m >= a) & (m <= b)].mean()), 3) for a, b in zip(q[:-1], q[1:])])
for c in ['T', 'I', 'F']:
    ss = np.array([r[c][0] if r[c] else np.nan for r in R]); mk = ~np.isnan(ss)
    print('core', c, 'corr sesgo-retorno 18-22', '%+.3f (t%+.1f)' % ic(np.nan_to_num(ss), x, mk & (d < '2023')), '23-26', '%+.3f (t%+.1f)' % ic(np.nan_to_num(ss), x, mk & (d >= '2023')))
