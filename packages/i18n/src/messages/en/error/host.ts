import { defineMessages } from "../../../message";

export const messages = defineMessages("error.host", {
  "error.host.webRtcNotConfigured": "The WebRTC host service is not configured.",
  "error.host.relayIdentityMissing": "Import a certificate before you share this OpenBot through a relay server.",
  "error.host.relayRefused":
    "This OpenBot cannot connect to the relay server. Check its certificate and relay address.",
  "error.host.nameBeforePublish": "Name this OpenBot before publishing it.",
  "error.host.publishBeforeInvite": "Make this OpenBot public before creating an invite.",
  "error.host.teamAccessUnavailable": "Your team access is unavailable.",
  "error.host.ownerIdentityUnavailable": "The host owner identity is unavailable.",
  "error.host.publishFailed": "This OpenBot could not be published.",
  "error.host.noServer": "This computer has no server to change.",
  "error.host.identityLocalOnly": "The server name and logo can only be changed on the computer that runs it.",
  "error.host.timezoneInvalid": "This timezone is not known.",
  "error.host.signalHomeUnknown": "This Signal server is not available.",
  "error.host.turnLimitInvalid": "This thread limit is not valid.",
  "error.host.maintenanceInterrupted":
    "Interrupted host maintenance. Verify the application and reset host state before retrying.",
  "error.host.updateFailed":
    "Host update failed during {phase}. Verify bundle ownership, signing, tenant status and free disk space before resetting state.",
  "error.host.tenantsNotIdle": "Tenants did not remain idle for five minutes within two hours.",
  "error.host.tenantShutdownTimeout": "Tenant shutdown timed out. No application replacement was started.",
  "error.host.tenantHealthMissing":
    "Tenant health reports are missing or unhealthy after restart. Inspect tenant sessions before another update.",
  "error.host.personalityInvalid": "This response style is not known.",
});
