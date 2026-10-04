"""Compile and render the unmodified production shaders in software OpenGL ES 3.
Requires Linux libEGL/Mesa, not PyOpenGL. This is NOT browser WebGL2 or hardware QA.
"""
from pathlib import Path
import ctypes as C
import ctypes.util
import json, os, re, subprocess
os.environ.setdefault('EGL_PLATFORM','surfaceless')
os.environ.setdefault('LIBGL_ALWAYS_SOFTWARE','1')
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'tests'/'review-output';OUT.mkdir(exist_ok=True)
# TETRA_EGL may point at another EGL implementation (for example ANGLE's libEGL.so bundled with Chromium).
EGL_PATH=os.environ.get('TETRA_EGL') or ctypes.util.find_library('EGL')
if not EGL_PATH: raise SystemExit('No EGL library found; set TETRA_EGL to a libEGL.so')
if os.environ.get('TETRA_GLES'): C.CDLL(os.environ['TETRA_GLES'],mode=C.RTLD_GLOBAL)
E=C.CDLL(EGL_PATH)
def egl(name,result,args):
 f=getattr(E,name);f.restype=result;f.argtypes=args;return f
ptr=C.c_void_p;I=C.c_int;U=C.c_uint;F=C.c_float
get=egl('eglGetDisplay',ptr,[ptr]);initialize=egl('eglInitialize',U,[ptr,C.POINTER(I),C.POINTER(I)])
bind=egl('eglBindAPI',U,[U]);choose=egl('eglChooseConfig',U,[ptr,C.POINTER(I),C.POINTER(ptr),I,C.POINTER(I)])
context=egl('eglCreateContext',ptr,[ptr,ptr,ptr,C.POINTER(I)])
surface=egl('eglCreatePbufferSurface',ptr,[ptr,ptr,C.POINTER(I)])
current=egl('eglMakeCurrent',U,[ptr,ptr,ptr,ptr]);proc=egl('eglGetProcAddress',ptr,[C.c_char_p])
display=get(None);major=I();minor=I();assert initialize(display,C.byref(major),C.byref(minor)), 'EGL initialization failed';assert bind(0x30A0)
attrs=(I*13)(0x3033,1,0x3040,0x40,0x3024,8,0x3023,8,0x3022,8,0x3021,8,0x3038)
config=ptr();count=I();assert choose(display,attrs,C.byref(config),1,C.byref(count)) and count.value>0
ctx=context(display,config,None,(I*3)(0x3098,3,0x3038));surf=surface(display,config,(I*5)(0x3057,1,0x3056,1,0x3038));assert ctx and surf and current(display,surf,surf,ctx)
def gl(name,result,*args):
 p=proc(name.encode());assert p,name;return C.CFUNCTYPE(result,*args)(p)
getstr=gl('glGetString',C.c_char_p,U);create_shader=gl('glCreateShader',U,U);source=gl('glShaderSource',None,U,I,C.POINTER(C.c_char_p),C.POINTER(I));compile_shader=gl('glCompileShader',None,U);shader_iv=gl('glGetShaderiv',None,U,U,C.POINTER(I));shader_log=gl('glGetShaderInfoLog',None,U,I,C.POINTER(I),C.c_void_p)
create_program=gl('glCreateProgram',U);attach=gl('glAttachShader',None,U,U);link=gl('glLinkProgram',None,U);program_iv=gl('glGetProgramiv',None,U,U,C.POINTER(I));program_log=gl('glGetProgramInfoLog',None,U,I,C.POINTER(I),C.c_void_p)
use=gl('glUseProgram',None,U);location=gl('glGetUniformLocation',I,U,C.c_char_p);onef=gl('glUniform1f',None,I,F);twof=gl('glUniform2f',None,I,F,F);onei=gl('glUniform1i',None,I,I);viewport=gl('glViewport',None,I,I,I,I);draw=gl('glDrawArrays',None,U,I,I);read=gl('glReadPixels',None,I,I,I,I,U,U,C.c_void_p)
compiled=json.loads(subprocess.check_output(['node','-e',"require('./src/precision.js');require('./src/core.js');require('./src/gpu.js');console.log(JSON.stringify(TetraGPU.sources))"],cwd=ROOT,text=True))
checks=[]
def build(fragment_name):
 program=create_program()
 for name,kind,code in [('vertex',0x8B31,compiled['vertex']),(fragment_name,0x8B30,compiled[fragment_name])]:
  shader=create_shader(kind);encoded=C.c_char_p(code.encode());source(shader,1,C.byref(encoded),None);compile_shader(shader);ok=I();shader_iv(shader,0x8B81,C.byref(ok))
  if not ok.value:
   log=C.create_string_buffer(8192);shader_log(shader,8192,None,log);raise RuntimeError(log.value.decode())
  attach(program,shader);checks.append({'name':name+' production shader compiles','passed':True})
 link(program);ok=I();program_iv(program,0x8B82,C.byref(ok))
 if not ok.value:
  log=C.create_string_buffer(8192);program_log(program,8192,None,log);raise RuntimeError(log.value.decode())
 checks.append({'name':fragment_name+' program links','passed':True});return program
build('perturb')
program=build('direct');use(program);viewport(0,0,1,1)
u={name:location(program,('u'+name).encode()) for name in ['Size','Center','Span','Iterations','Palette','Samples','Adaptive','LowA','MaxB','Tol','Threshold']}
twof(u['Size'],1,1);onef(u['Span'],1);onei(u['Iterations'],512);onei(u['Palette'],0);onei(u['Samples'],1);onei(u['Adaptive'],0);onef(u['LowA'],-80);onef(u['MaxB'],1e6);onef(u['Tol'],2e-6);onef(u['Threshold'],.035)
cases=[('fixed',.5,0),('period2',.01,0),('threshold',2,0),('origin',0,0),('complex',.5,.25)]
js="require('./src/precision.js');const c=require('./src/core.js');const cases="+json.dumps(cases)+";console.log(JSON.stringify(cases.map(([name,x,y])=>{const r=c.orbitRules(x,y,512,c.RULES.gpu);return {name,kind:r.kind,color:c.color(r.kind,r.steps,0,r.re,r.im)}})))"
expected=json.loads(subprocess.check_output(['node','-e',js],cwd=ROOT,text=True))
for (name,x,y),item in zip(cases,expected):
 twof(u['Center'],x,y);draw(4,0,3);pixel=(C.c_ubyte*4)();read(0,0,1,1,0x1908,0x1401,pixel)
 assert max(abs(pixel[i]-item['color'][i]) for i in range(3))<=1,(name,list(pixel),item)
 checks.append({'name':'Rendered pixel vs FP64 color: '+name,'passed':True,'rgba':list(pixel),'expected_rgb':item['color']})
report={'checks':checks,'count':len(checks),'renderer':getstr(0x1F01).decode(),'version':getstr(0x1F02).decode(),'limitation':'Software OpenGL ES; does not validate browser WebGL2 or hardware drivers.'}
(OUT/'gpu-software.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
current(display,None,None,None);egl('eglDestroySurface',U,[ptr,ptr])(display,surf);egl('eglDestroyContext',U,[ptr,ptr])(display,ctx);egl('eglTerminate',U,[ptr])(display)
