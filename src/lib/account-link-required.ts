/** A matching address must be confirmed from the existing account first. */
export class AccountLinkRequiredError extends Error {
  constructor() {
    super("Sign in to the existing account, then connect this sign-in method in Settings");
    this.name = "AccountLinkRequiredError";
  }
}
