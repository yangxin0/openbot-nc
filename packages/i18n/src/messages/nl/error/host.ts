import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/host";

export const messages = {
  "error.host.webRtcNotConfigured": "De WebRTC-hostservice is niet geconfigureerd.",
  "error.host.nameBeforePublish": "Geef deze OpenBot een naam voordat je hem publiceert.",
  "error.host.publishBeforeInvite": "Maak deze OpenBot openbaar voordat je een uitnodiging maakt.",
  "error.host.teamAccessUnavailable": "Je teamtoegang is niet beschikbaar.",
  "error.host.ownerIdentityUnavailable": "De identiteit van de eigenaar van de host is niet beschikbaar.",
  "error.host.publishFailed": "Deze OpenBot kon niet worden gepubliceerd.",
  "error.host.noServer": "Deze computer heeft geen server om te wijzigen.",
  "error.host.identityLocalOnly":
    "De naam en het logo van de server kun je alleen wijzigen op de computer waarop de server draait.",
  "error.host.timezoneInvalid": "Deze tijdzone is onbekend.",
  "error.host.signalHomeUnknown": "Deze Signal-server is niet beschikbaar.",
  "error.host.turnLimitInvalid": "Deze threadlimiet is ongeldig.",
  "error.host.maintenanceInterrupted":
    "Onderhoud van de host is onderbroken. Controleer de app en zet de status van de host terug voordat je het opnieuw probeert.",
  "error.host.updateFailed":
    "Update van de host is mislukt tijdens {phase}. Controleer het eigendom van de bundel, de ondertekening, de status van tenants en de vrije schijfruimte voordat je de status terugzet.",
  "error.host.tenantsNotIdle": "Tenants zijn binnen twee uur niet vijf minuten inactief gebleven.",
  "error.host.tenantShutdownTimeout": "Het afsluiten van tenants duurde te lang. Er is geen app vervangen.",
  "error.host.tenantHealthMissing":
    "Statusrapporten van tenants ontbreken of zijn niet in orde na de herstart. Controleer de sessies van tenants voor een volgende update.",
  "error.host.personalityInvalid": "Deze antwoordstijl is onbekend.",
} as const satisfies PartialTranslation<typeof source>;
