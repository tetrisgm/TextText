using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using TextText.Core;
namespace TextText.Windows;

public sealed partial class MainWindow
{
    private void ShowRetainedWorkReview()
    {
        var panel=new StackPanel {Width=420,HorizontalAlignment=HorizontalAlignment.Center,VerticalAlignment=VerticalAlignment.Center};
        var status=new TextBlock {Text="Review this folder's saved work before connecting it to your account. Your original files remain on this computer.",TextWrapping=TextWrapping.Wrap};
        panel.Children.Add(status);
        var review=new Button {Content="Review saved work",Margin=new Thickness(0,16,0,0)};
        review.Click+=async (_,_)=> {
            review.IsEnabled=false;
            try {await OpenWorkspace();}
            catch {status.Text="Saved work could not be connected. Reconnect, close other TextText windows using this folder, and try again. Original files remain available.";}
            finally {review.IsEnabled=true;}
        };
        panel.Children.Add(review);SetWorkspaceContent(panel);
    }
    private async Task<bool> ReviewRetainedWork(string folder,Account selected,Account identity)
    {
        if(selected.AccountId is null)throw new InvalidOperationException("Reconnect to verify your account first.");
        using var initial=CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);initial.CancelAfter(TimeSpan.FromSeconds(30));
        var reviewed=await AccountIdentity.ReviewAsync(http,Origin,identity,initial.Token);
        var directory=new WorkspaceDirectory(http,Origin,()=>Task.FromResult(identity.Token));
        await directory.AuthorizeAsync(selected.WorkspaceId,initial.Token);
        if(!ReferenceEquals(account,identity)||reviewed.AccountId!=selected.AccountId)throw new SharedAccountMismatchException();
        var dialog=new Window {Owner=this,Title="Review saved work",SizeToContent=SizeToContent.WidthAndHeight,ResizeMode=ResizeMode.NoResize,WindowStartupLocation=WindowStartupLocation.CenterOwner};
        var panel=new StackPanel {Width=460,Margin=new Thickness(24)};
        panel.Children.Add(new TextBlock {Text="Keep this saved work with "+reviewed.Email+"?",FontSize=20,TextWrapping=TextWrapping.Wrap});
        panel.Children.Add(new TextBlock {Text=folder,TextWrapping=TextWrapping.Wrap,Margin=new Thickness(0,16,0,12)});
        panel.Children.Add(new TextBlock {Text="This folder contains work saved before account ownership was recorded. Continue only if it belongs to this account. Pending edits will sync when this account has permission. TextText will keep the original recovery records.",TextWrapping=TextWrapping.Wrap});
        var buttons=new WrapPanel {Margin=new Thickness(0,20,0,0)};
        var keep=new Button {Content="Keep saved work",Padding=new Thickness(12,6,12,6)};
        var open=new Button {Content="Open folder",Margin=new Thickness(8,0,0,0),Padding=new Thickness(12,6,12,6)};
        var cancel=new Button {Content="Cancel",IsCancel=true,Margin=new Thickness(8,0,0,0),Padding=new Thickness(12,6,12,6)};
        keep.Click+=(_,_)=>dialog.DialogResult=true;
        open.Click+=(_,_)=>Process.Start(new ProcessStartInfo(folder){UseShellExecute=true});
        buttons.Children.Add(keep);buttons.Children.Add(open);buttons.Children.Add(cancel);panel.Children.Add(buttons);dialog.Content=panel;
        if(dialog.ShowDialog()!=true)return false;
        using var final=CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);final.CancelAfter(TimeSpan.FromSeconds(30));
        var confirmed=await AccountIdentity.ReviewAsync(http,Origin,identity,final.Token);
        await directory.AuthorizeAsync(selected.WorkspaceId,final.Token);
        if(!ReferenceEquals(account,identity)||confirmed.AccountId!=reviewed.AccountId)throw new SharedAccountMismatchException();
        // A live old view must finish its durable barrier before retiring its writer.
        if(string.Equals(root,folder,StringComparison.OrdinalIgnoreCase)&&bridge is { } previous) {
            if(!await FlushEditor())throw new IOException("Save the open document before reviewing this folder.");
            if(!ReferenceEquals(account,identity))throw new SharedAccountMismatchException();
            await previous.RetireAsync();bridge=null;
        }
        final.Token.ThrowIfCancellationRequested();
        if(!ReferenceEquals(account,identity))throw new SharedAccountMismatchException();
        AccountStateAdoption.AdoptAfterExplicitReview(WindowsBridge.OpenStore(folder,Origin,selected.WorkspaceId),Origin,selected.WorkspaceId,reviewed.AccountId);
        return true;
    }
}
