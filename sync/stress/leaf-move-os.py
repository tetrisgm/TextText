"""Finite ordinary OS no-overwrite leaf rename; stdin JSON, no TextText writer."""
import ctypes, hashlib, json, os, stat, sys

def run(value):
    if not isinstance(value, dict) or set(value) != {'source','destination','fileIdentity','parentIdentity','archiveSha256'}:
        raise ValueError('Invalid OS leaf request')
    source, destination = value['source'], value['destination']
    if not isinstance(source,str) or not isinstance(destination,str) or not os.path.isabs(source) or os.path.dirname(source) != os.path.dirname(destination) or source == destination:
        raise ValueError('Same parent required')
    for path in [source, destination]:
        parent = os.path.dirname(path)
        while True:
            info = os.lstat(parent)
            if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode): raise ValueError('Unsafe ancestor')
            above = os.path.dirname(parent)
            if above == parent: break
            parent = above
    parent_info=os.lstat(os.path.dirname(source))
    if str(parent_info.st_dev)+':'+str(parent_info.st_ino) != value['parentIdentity']: raise ValueError('Parent identity changed')
    before = os.lstat(source)
    if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size > 64*1024*1024: raise ValueError('Unsafe source')
    identity = str(before.st_dev)+':'+str(before.st_ino)
    with open(source,'rb') as stream:
        opened = os.fstat(stream.fileno())
        digest = hashlib.sha256(stream.read(64*1024*1024+1)).hexdigest()
        after = os.fstat(stream.fileno())
    def stamp(s): return (s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
    if stamp(before) != stamp(opened) or stamp(before) != stamp(after) or stamp(before) != stamp(os.lstat(source)) or identity != value['fileIdentity'] or digest != value['archiveSha256']: raise ValueError('Source changed')
    if os.path.lexists(destination): raise ValueError('Destination occupied')
    if sys.platform != 'darwin': raise ValueError('Unsupported OS; no overwrite fallback')
    flags=os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    parent_fd=os.open(os.path.dirname(source),flags)
    source_fd=None
    try:
        parent_now=os.fstat(parent_fd)
        if str(parent_now.st_dev)+':'+str(parent_now.st_ino) != value['parentIdentity']: raise ValueError('Pinned parent changed')
        source_leaf,destination_leaf=os.path.basename(source),os.path.basename(destination)
        source_fd=os.open(source_leaf,os.O_RDONLY | os.O_NOFOLLOW,dir_fd=parent_fd)
        if stamp(os.fstat(source_fd)) != stamp(before): raise ValueError('Pinned source changed')
        # Anchored parent prevents a replaced ancestor from redirecting rename.
        # Darwin has no expected-inode rename CAS: a final leaf replacement can
        # still be captured; postidentity failure retains it, never rolls back.
        if str(os.lstat(os.path.dirname(source)).st_dev)+':'+str(os.lstat(os.path.dirname(source)).st_ino) != value['parentIdentity'] or stamp(os.stat(source_leaf,dir_fd=parent_fd,follow_symlinks=False)) != stamp(before): raise ValueError('Pre-rename identity changed')
        libc=ctypes.CDLL(None,use_errno=True)
        rename=libc.renameatx_np
        rename.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint];rename.restype=ctypes.c_int
        if rename(parent_fd,os.fsencode(source_leaf),parent_fd,os.fsencode(destination_leaf),0x4 | 0x10) != 0: raise OSError(ctypes.get_errno(),'No-overwrite rename refused')
        final=os.stat(destination_leaf,dir_fd=parent_fd,follow_symlinks=False)
        fd=os.open(destination_leaf,os.O_RDONLY | os.O_NOFOLLOW,dir_fd=parent_fd)
        try:
            with os.fdopen(fd,'rb') as stream: final_hash=hashlib.sha256(stream.read(64*1024*1024+1)).hexdigest()
        except: raise
        if str(os.lstat(os.path.dirname(destination)).st_dev)+':'+str(os.lstat(os.path.dirname(destination)).st_ino) != value['parentIdentity'] or os.path.lexists(source) or str(final.st_dev)+':'+str(final.st_ino) != identity or final_hash != digest: raise ValueError('Rename result requires review; paths preserved')
    finally:
        if source_fd is not None: os.close(source_fd)
        os.close(parent_fd)
    return {'renamed':True,'fileIdentity':identity,'archiveSha256':digest}

if __name__ == '__main__':
    try:
        raw=sys.stdin.buffer.read(16385)
        if len(raw)>16384: raise ValueError('Request too large')
        print(json.dumps(run(json.loads(raw))))
    except Exception:
        print(json.dumps({'renamed':False,'error':'OS leaf move refused; paths and evidence preserved'}))
        sys.exit(1)
