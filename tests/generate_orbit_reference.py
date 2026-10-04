"""Regenerate independent fixed-height fixtures using mpmath (300 decimal digits).
Optional QA dependency only. Run from any working directory.
These fixtures check finite iterates, not convergence proofs.
"""
from pathlib import Path
import json
import mpmath as mp
mp.mp.dps = 300
cases = [
 ('positive-real','0.5','0',4),('tiny-complex','0.00000001','0.00000002',4),
 ('upper-half','0.5','0.25',4),('lower-half','0.5','-0.25',4),
 ('negative-axis','-0.5','0',4),('upper-cut','-0.5','1e-40',4),('lower-cut','-0.5','-1e-40',4),
 ('stable-complex','-0.2','0.7',4),('near-one','1.0000000001','0.0000000001',4),
 ('deep-center','0.5','0',4),
 ('deep-displaced','0.'+'5'+'0'*198+'1','1e-200',4),
 ('tiny-positive','1e-200','0',4),
]
out=[]
for label,x,y,iterations in cases:
 z=mp.mpc(x,y);l=mp.log(z);w=mp.mpc(1)
 for _ in range(iterations): w=mp.exp(w*l)
 out.append(dict(label=label,x=x,y=y,iterations=iterations,re=mp.nstr(w.real,285),im=mp.nstr(w.imag,285)))
path=Path(__file__).with_name('orbit-reference.json')
path.write_text(json.dumps({'generator':'mpmath '+mp.__version__,'decimal_digits':300,'convention':'w0=1; principal log; negative axis +pi','cases':out},indent=2)+'\n')
print('Wrote',len(out),'independent finite-orbit fixtures')
