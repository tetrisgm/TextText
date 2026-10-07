using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
namespace TextText.Core;
internal static class ProviderPaths
{
    [StructLayout(LayoutKind.Sequential)] struct AttributeTag {public uint Attributes;public uint Tag;}
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern SafeFileHandle CreateFileW(string name,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
    [DllImport("kernel32.dll",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] static extern bool GetFileInformationByHandleEx(SafeFileHandle handle,int infoClass,out AttributeTag info,uint size);
    public static bool IsUnsafeReparse(string path)
    {
        if((File.GetAttributes(path)&FileAttributes.ReparsePoint)==0)return false;
        if(!OperatingSystem.IsWindows())return true;
        // Cloud Files placeholders are data, not namespace redirects. Inspect the
        // tag without following a junction or symbolic link.
        using var handle=CreateFileW(path,0,7,IntPtr.Zero,3,0x02200000,IntPtr.Zero);
        if(handle.IsInvalid || !GetFileInformationByHandleEx(handle,9,out var info,(uint)Marshal.SizeOf<AttributeTag>()))return true;
        return (info.Tag & 0xFFFF0FFFu)!=0x9000001Au;
    }
}
