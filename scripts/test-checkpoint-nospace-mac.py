# Explicit manual test: creates/fills only a new 32 MiB image, then detaches it.
# Retains the image and logs; never operates on an existing disk or user workspace.
from pathlib import Path
import argparse,os,subprocess,tempfile
parser=argparse.ArgumentParser()
parser.add_argument("--adoption",action="store_true")
args=parser.parse_args()
case="LocalVaultAccountStateAdoptionTests.testDiskFullAdoptionRetainsOriginalsAndResumes" if args.adoption else "LocalVaultSharedEditingTests.testCheckpointNoSpacePreservesPriorGenerationAndRecovers"
repository=Path(__file__).resolve().parents[1]
base=Path(tempfile.mkdtemp(prefix='texttext-checkpoint-enospc-'));image=base/'isolated.dmg';mount=base/'volume';mount.mkdir()
def run(args):
 r=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
 print(r.stdout[-1600:],flush=True);r.check_returncode()
run(['hdiutil','create','-size','32m','-fs','HFS+','-volname','TextTextCheckpointFixture','-type','UDIF','-nospotlight',str(image)])
run(['hdiutil','attach','-nobrowse','-mountpoint',str(mount),str(image)])
lock=repository/'mac/Package.resolved';original=lock.read_bytes()
try:
 (mount/'.texttext-checkpoint-test-volume').write_text('texttext checkpoint ENOSPC fixture v1\n')
 env=os.environ.copy();env.update(TEXTTEXT_STORE='1');env['TEXTTEXT_ADOPTION_NOSPACE_VOLUME' if args.adoption else 'TEXTTEXT_CHECKPOINT_NOSPACE_VOLUME']=str(mount)
 with (base/'swift-test.log').open('w') as out:
  result=subprocess.run(['swift','test','--package-path','mac','--jobs','2','--filter',case],cwd=repository,env=env,stdout=out,stderr=subprocess.STDOUT)
 print((base/'swift-test.log').read_text()[-3500:],flush=True)
 result.check_returncode()
 assert (case.split(".")[1]+"]\' passed") in (base/'swift-test.log').read_text(), "Required real disk-full test did not pass"
finally:
 lock.write_bytes(original)
 run(['hdiutil','detach',str(mount)])
print('Isolated image and receipt retained at',base)
