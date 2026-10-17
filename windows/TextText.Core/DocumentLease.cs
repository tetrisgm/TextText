using System.Text.RegularExpressions;
namespace TextText.Core;

/// Device-local handle ownership. Never unlink the file: process death closes
/// the handle and releases exclusion without a stale timestamp or lock reset.
internal sealed class DocumentLease : IDisposable
{
    readonly FileStream handle;
    public DocumentLease(string stateDirectory,string itemId) {
        if(!Regex.IsMatch(itemId,@"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\z"))throw new InvalidDataException("Invalid document identity.");
        var path=Path.Combine(stateDirectory,"document-"+itemId+".lock");
        if(File.Exists(path)&&(File.GetAttributes(path)&FileAttributes.ReparsePoint)!=0)throw new InvalidDataException("Invalid document ownership file.");
        handle=new FileStream(path,FileMode.OpenOrCreate,FileAccess.ReadWrite,FileShare.None);
    }
    public void Dispose()=>handle.Dispose();
}
