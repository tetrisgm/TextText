# Finite source-handle no-overwrite ordinary OS rename. JSON stdin only.
$ErrorActionPreference = 'Stop'
try {
  $raw = [Console]::In.ReadToEnd()
  if ($raw.Length -gt 16384) { throw 'Request limit' }
  $value = $raw | ConvertFrom-Json
  if ((@($value.PSObject.Properties.Name | Sort-Object) -join ',') -cne 'archiveSha256,destination,fileIdentity,parentIdentity,source') { throw 'Request fields' }
  Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32.SafeHandles;
public static class OwnedLeafRename {
 [StructLayout(LayoutKind.Sequential)] struct Info { public uint Attributes; public System.Runtime.InteropServices.ComTypes.FILETIME Creation,Access,Write; public uint Volume,SizeHigh,SizeLow,Links,IndexHigh,IndexLow; }
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern SafeFileHandle CreateFileW(string name,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle handle,out Info info);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetFileInformationByHandle(SafeFileHandle handle,int kind,IntPtr buffer,uint length);
 static Info Read(SafeFileHandle h) { Info i;if(h.IsInvalid||!GetFileInformationByHandle(h,out i)||(i.Attributes&0x400)!=0)throw new IOException("Unsafe identity");return i; }
 static string Identity(Info i) { return i.Volume.ToString()+":"+(((ulong)i.IndexHigh<<32)|i.IndexLow).ToString(); }
 public static void Move(string from,string to,string identity,string parentIdentity,string hash) {
  from=Path.GetFullPath(from);to=Path.GetFullPath(to);
  if(from==to||Path.GetDirectoryName(from)!=Path.GetDirectoryName(to))throw new IOException("Parent mismatch");
  var pins=new List<SafeFileHandle>();
  try {
   // Pin all ancestors without FILE_SHARE_DELETE; refuse reparse points.
   var ancestors=new List<string>();var at=Path.GetDirectoryName(from);
   while(!String.IsNullOrEmpty(at)){ancestors.Add(at);var parent=Path.GetDirectoryName(at);if(parent==at)break;at=parent;}
   ancestors.Reverse();foreach(var parent in ancestors){var h=CreateFileW(parent,0x80,3,IntPtr.Zero,3,0x02200000,IntPtr.Zero);pins.Add(h);if((Read(h).Attributes&0x10)==0||(parent==Path.GetDirectoryName(from)&&Identity(Read(h))!=parentIdentity))throw new IOException("Not directory");}
   using(var file=CreateFileW(from,0x80010000,3,IntPtr.Zero,3,0x00200000,IntPtr.Zero)) {
    var before=Read(file);if((before.Attributes&0x10)!=0||before.Links!=1||before.SizeHigh!=0||before.SizeLow>67108864||Identity(before)!=identity)throw new IOException("Source identity mismatch");
    using(var stream=new FileStream(file,FileAccess.Read,65536,false)) {
     string actual;using(var sha=SHA256.Create()){actual=BitConverter.ToString(sha.ComputeHash(stream)).Replace("-","").ToLowerInvariant();}
     if(actual!=hash||Identity(Read(file))!=identity||File.Exists(to)||Directory.Exists(to))throw new IOException("Baseline/destination mismatch");
     var name=Encoding.Unicode.GetBytes(to);int rootOffset=IntPtr.Size==8?8:4,lenOffset=rootOffset+IntPtr.Size,nameOffset=lenOffset+4,length=nameOffset+name.Length;
     var buffer=Marshal.AllocHGlobal(length);try{for(int n=0;n<length;n++)Marshal.WriteByte(buffer,n,0);Marshal.WriteIntPtr(buffer,rootOffset,IntPtr.Zero);Marshal.WriteInt32(buffer,lenOffset,name.Length);Marshal.Copy(name,0,IntPtr.Add(buffer,nameOffset),name.Length);
      // FILE_RENAME_INFO.ReplaceIfExists=false, exact held source handle.
      if(!SetFileInformationByHandle(file,3,buffer,(uint)length))throw new IOException("No-overwrite OS rename refused");
     }finally{Marshal.FreeHGlobal(buffer);}
     if(Identity(Read(file))!=identity)throw new IOException("Postidentity mismatch");
    }
   }
  } finally { foreach(var pin in pins)pin.Dispose(); }
 }
}
'@
  [OwnedLeafRename]::Move([string]$value.source,[string]$value.destination,[string]$value.fileIdentity,[string]$value.parentIdentity,[string]$value.archiveSha256)
  @{renamed=$true;archiveSha256=$value.archiveSha256;fileIdentity=$value.fileIdentity} | ConvertTo-Json -Compress
} catch {
  [Console]::Out.WriteLine('{"renamed":false,"error":"OS leaf move refused; paths and evidence preserved"}')
  exit 1
}
