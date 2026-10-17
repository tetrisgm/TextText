using System.Text.RegularExpressions;
namespace TextText.Core;

/// Device-local handle ownership. Never unlink the file: process death closes
/// the handle and releases exclusion without a stale timestamp or lock reset.
internal sealed class DocumentLease : IDisposable
{
    readonly FileStream handle;
    public DocumentLease(string stateDirectory,string itemId):this(Path.Combine(stateDirectory,FileName(itemId))) { }
    static string FileName(string itemId) {
        if(!Regex.IsMatch(itemId,@"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\z"))throw new InvalidDataException("Invalid document identity.");
        return "document-"+itemId+".lock";
    }
    internal static DocumentLease Workspace(string stateDirectory)=>new(Path.Combine(stateDirectory,"sync.lock"));
    DocumentLease(string path) {
        if(File.Exists(path)&&(File.GetAttributes(path)&FileAttributes.ReparsePoint)!=0)throw new InvalidDataException("Invalid document ownership file.");
        handle=new FileStream(path,FileMode.OpenOrCreate,FileAccess.ReadWrite,FileShare.None);
    }
    public void Dispose()=>handle.Dispose();
}

/// Editing and background sync share the same workspace writer. Refcounts are
/// local to one engine; another actor/process must acquire the OS lock itself.
internal sealed class WorkspaceWriterOwnership(string stateDirectory)
{
    readonly object gate=new();DocumentLease? held;int references;
    public IDisposable Acquire() {
        lock(gate){held??=DocumentLease.Workspace(stateDirectory);references++;return new Reference(this);}
    }
    void Release(){lock(gate){if(--references==0){held!.Dispose();held=null;}}}
    sealed class Reference(WorkspaceWriterOwnership owner):IDisposable {
        WorkspaceWriterOwnership? current=owner;
        public void Dispose()=>Interlocked.Exchange(ref current,null)?.Release();
    }
}
