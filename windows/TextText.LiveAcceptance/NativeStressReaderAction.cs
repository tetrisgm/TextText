// Private actor reader transition. No normal product project includes this helper.
static class NativeStressReaderAction
{
    private const string Action = """
    (activate => {
      const visible = element => !!element && !element.closest('[hidden],[inert]')
        && element.getClientRects().length > 0
        && getComputedStyle(element).visibility === 'visible';
      const body = document.querySelector('[aria-label="Document body"]');
      if (body?.isContentEditable && visible(body)) return true;
      const actions = [...document.querySelectorAll('.vault-note-display .vault-note-display-actions > button[aria-label="Edit card"], .vault-story-display .vault-story-display-actions > button')]
        .filter(button => visible(button) && !button.disabled && button.getAttribute('aria-disabled') !== 'true'
          && (button.matches('.vault-note-display .vault-note-display-actions > button[aria-label="Edit card"]')
            || button.textContent.trim() === 'Edit story'));
      if (actions.length !== 1) return false;
      if (activate) actions[0].click();
      return true;
    })
    """;
    internal const string Ready = Action + "(false)";
    internal const string Activate = Action + "(true)";
}
