import os,sys,subprocess,json,hashlib,ctypes,datetime
root=int(sys.argv[1]);out={'observedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'processes':[],'error':None}
try:
 rows=subprocess.check_output(['/bin/ps','-A','-o','pid=,ppid='],env={**os.environ,'LC_ALL':'C'},text=True).splitlines()
 parents={int(x.split()[0]):int(x.split()[1]) for x in rows}
 selected={root}
 for _ in range(256):
  extra={pid for pid,ppid in parents.items() if ppid in selected}
  if extra<=selected:break
  selected|=extra
 if len(selected)>256:raise RuntimeError('process-bound')
 lib=ctypes.CDLL('/usr/lib/libproc.dylib')
 class BSD(ctypes.Structure):
  _fields_=[('prefix',ctypes.c_uint32*12),('comm',ctypes.c_char*16),('name',ctypes.c_char*32),('middle',ctypes.c_uint32*6),('startsec',ctypes.c_uint64),('startusec',ctypes.c_uint64)]
 def bsd(pid):
  info=BSD()
  if lib.proc_pidinfo(pid,3,0,ctypes.byref(info),ctypes.sizeof(info))!=ctypes.sizeof(info):raise RuntimeError('unavailable')
  return info

 for pid in sorted(selected):
  line=subprocess.check_output(['/bin/ps','-p',str(pid),'-o','lstart=,time=,rss='],env={**os.environ,'LC_ALL':'C'},text=True).strip().split()
  if len(line)!=7:raise RuntimeError('unavailable')
  before=bsd(pid);start=str(before.startsec)+':'+str(before.startusec);clock=line[5];rss=int(line[6])*1024
  days=0
  if '-' in clock:d,clock=clock.split('-',1);days=int(d)
  parts=[float(x) for x in clock.split(':')];cpu=days*86400+sum(v*(60**i) for i,v in enumerate(reversed(parts)))
  buf=ctypes.create_string_buffer(4096)
  if lib.proc_pidpath(pid,buf,len(buf))<=0:raise RuntimeError('unavailable')
  path=buf.value.decode();h=hashlib.sha256()
  with open(path,'rb') as f:
   for b in iter(lambda:f.read(1048576),b''):h.update(b)
  after=bsd(pid)
  if (after.startsec,after.startusec,after.prefix[4])!=(before.startsec,before.startusec,before.prefix[4]):raise RuntimeError('identity-changed')
  out['processes'].append({'identity':{'pid':pid,'parentPid':int(before.prefix[4]),'startKey':start,'session':str(os.getsid(pid)),'executableSha256':h.hexdigest()},'cpuSeconds':cpu,'rssBytes':rss,'privateBytes':None})
 rows2=subprocess.check_output(['/bin/ps','-A','-o','pid=,ppid='],env={**os.environ,'LC_ALL':'C'},text=True).splitlines()
 parents2={int(x.split()[0]):int(x.split()[1]) for x in rows2};selected2={root}
 for _ in range(256):
  extra={pid for pid,ppid in parents2.items() if ppid in selected2}
  if extra<=selected2:break
  selected2|=extra
 if selected2!=selected or any(parents.get(pid)!=parents2.get(pid) for pid in selected):raise RuntimeError('tree-unavailable')
except Exception as e:
 out['error']=str(e) if str(e) in ['process-bound','identity-changed','tree-unavailable'] else 'unavailable'
print(json.dumps(out,separators=(',',':')))
