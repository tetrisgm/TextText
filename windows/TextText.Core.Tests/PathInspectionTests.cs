using TextText.Core;

static class PathInspectionTests
{
    public static void Run(string temp,Action<bool,string> check)
    {
        var root=Path.Combine(temp,"path-inspection");
        var store=new TextPackStore(root,Path.Combine(temp,"path-inspection-state"));
        var existing=Path.Combine(root,"regular.txt");File.WriteAllText(existing,"retained");
        check(store.Resolve("regular.txt")==existing,"path inspection accepts existing files");
        check(store.Resolve("missing/new.textpack")==Path.Combine(root,"missing","new.textpack"),"path inspection accepts missing creation destinations");
        RetainedFileReplacement.CheckPath(existing);
        RetainedFileReplacement.CheckPath(Path.Combine(root,"missing","new.textpack"));
        var target=Path.Combine(root,"target");Directory.CreateDirectory(target);
        var linked=Path.Combine(root,"linked");Directory.CreateSymbolicLink(linked,target);
        var refused=false;try{store.Resolve("linked/new.textpack");}catch(IOException){refused=true;}
        check(refused,"missing leaf cannot hide a linked workspace ancestor");
        refused=false;try{RetainedFileReplacement.CheckPath(Path.Combine(linked,"new.textpack"));}catch(IOException){refused=true;}
        check(refused,"retained recovery inspection rejects linked ancestors");
        var dangling=Path.Combine(root,"dangling");Directory.CreateSymbolicLink(dangling,Path.Combine(root,"absent-target"));
        refused=false;try{store.Resolve("dangling/new.textpack");}catch(IOException){refused=true;}
        check(refused,"missing target does not hide a linked workspace ancestor");
        check(File.ReadAllText(existing)=="retained","path inspection preserves existing bytes");
    }
}
