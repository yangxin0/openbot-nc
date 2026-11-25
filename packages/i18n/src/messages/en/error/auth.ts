import { defineMessages } from "../../../message";

export const messages = defineMessages("error.auth", {
  "error.auth.companySignInFailed": "The company sign-in did not finish. Try again.",
  "error.auth.companySignInCancelled": "The company sign-in was cancelled.",
  "error.auth.companySignInTimeout": "The company sign-in took too long. Open the sign-in page again.",
  "error.auth.companySignInRefused": "The sign-in at your company was cancelled or refused.",
  "error.auth.companySignInDomainMismatch": "The company account has an email at a domain that is not in the setup.",
  "error.auth.companySignInAccountDisabled": "Your company turned off this account. Ask your administrator.",
  "error.auth.companySignInOff": "Company sign-in is off for this email.",
  "error.auth.companySignInEmailMissing": "Your company account did not give a verified email address.",
  "error.auth.companySignInUnavailable": "This OpenBot cannot open a browser for the company sign-in.",
  "error.auth.companySignInProviderRejected": "The provider did not accept the client ID or secret.",
  "error.auth.companySignInTokenInvalid": "The provider gave a sign-in that OpenBot cannot check.",
  "error.auth.companySignInProviderUnreachable": "The company sign-in provider did not answer.",
  "error.auth.companySignInDomainTaken": "One of these domains already signs in through another server.",
});
