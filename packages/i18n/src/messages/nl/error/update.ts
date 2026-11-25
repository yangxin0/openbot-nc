import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/update";

export const messages = {
  "error.update.unsupported": "Updates zijn beschikbaar in geïnstalleerde desktopbuilds.",
  "error.update.noSelfUpdate":
    "Deze build werkt zichzelf niet bij. Installeer zelf een nieuwere build om OpenBot-NC bij te werken.",
  "error.update.notReady": "Er is geen update klaar om te installeren.",
  "error.update.restartFailed": "OpenBot-NC kon niet herstarten om de update te installeren.",
  "error.update.downloadStalled": "De download van de update reageert niet meer. Probeer het opnieuw.",
  "error.update.installFailed":
    "Kan de update niet installeren. Stop OpenBot-NC, open het opnieuw en probeer het nog eens.",
  "error.update.notInstalled":
    "Bij de laatste herstart is de update niet geïnstalleerd. Start opnieuw om het nog eens te proberen.",
  "error.update.downloadFailed": "Kan de update niet downloaden. Probeer het opnieuw.",
  "error.update.signatureNotConfirmed":
    "OpenBot-NC kan de update niet verifiëren. Probeer het opnieuw. Blijft deze fout terugkomen, installeer OpenBot-NC dan opnieuw vanaf de plek waar je het hebt gekregen.",
  "error.update.checkFailed": "Kan niet controleren op updates. Probeer het opnieuw.",
  "error.update.checkStalled": "De controle op updates reageert niet meer. Probeer het opnieuw.",
  "error.update.checkOffline":
    "Kan de updateservice niet bereiken. Controleer je internetverbinding en probeer het opnieuw.",
  "error.update.checkUnavailable":
    "De updateservice reageerde niet. OpenBot-NC probeert het over een paar minuten zelf opnieuw.",
  "error.update.checkNoRelease":
    "Er is geen gepubliceerde update gevonden voor dit platform. OpenBot-NC probeert het over een paar minuten zelf opnieuw.",
  "error.update.managedByNix": "Nix installeert updates voor deze kopie van OpenBot-NC. Werk hem bij met Nix.",
  "error.update.managedByHost":
    "Updates op deze Mac worden door de host geïnstalleerd. De update blijft klaarstaan tot het onderhoud van de host draait.",
  "error.update.siblingSession":
    "Er draait nog een andere OpenBot-NC-sessie vanuit deze app. Stop OpenBot-NC eerst in alle andere macOS-gebruikersaccounts en installeer de update dan opnieuw.",
  "error.update.siblingSessionSameAccount":
    "Er draait nog een ander OpenBot-NC-proces in dit gebruikersaccount. Stop het en installeer de update dan opnieuw.",
  "error.update.siblingCheckFailed":
    "Kan andere OpenBot-NC-sessies niet controleren. Probeer het opnieuw voordat je installeert.",
  "error.update.readOnlyLocation":
    "OpenBot-NC kan vanaf deze locatie geen updates installeren. Sluit OpenBot-NC af. Sleep OpenBot-NC in de Finder naar de map Apps (staat het er al, sleep het er dan uit en weer in). Open OpenBot-NC daarna en installeer de update opnieuw.",
  "error.update.appImageMissing":
    "OpenBot-NC kan de update niet installeren, omdat het AppImage-bestand is verplaatst, hernoemd of vervangen. Sluit OpenBot-NC af en open het AppImage-bestand opnieuw.",
  "error.update.appImageReadOnly":
    "OpenBot-NC kan geen updates installeren in de map van het AppImage-bestand. Sluit OpenBot-NC af, verplaats het AppImage-bestand naar een map in je thuismap, open het en installeer de update opnieuw.",
  "error.update.remoteDisabled": "Updates door serverbeheerders staan uit op deze computer.",
  "error.update.restartStarted": "OpenBot-NC herstart al om de update te installeren.",
  "error.update.alreadyRestarting": "OpenBot-NC herstart al.",
} as const satisfies PartialTranslation<typeof source>;
