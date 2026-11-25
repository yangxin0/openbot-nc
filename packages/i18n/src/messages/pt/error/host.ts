import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/host";

export const messages = {
  "error.host.nameBeforePublish": "Dê um nome a este OpenBot-NC antes de publicá-lo.",
  "error.host.publishBeforeInvite": "Torne este OpenBot-NC público antes de criar um convite.",
  "error.host.teamAccessUnavailable": "Seu acesso à equipe está indisponível.",
  "error.host.ownerIdentityUnavailable": "A identidade do proprietário do computador anfitrião está indisponível.",
  "error.host.publishFailed": "Não foi possível publicar este OpenBot-NC.",
  "error.host.noServer": "Este computador não tem um servidor para alterar.",
  "error.host.identityLocalOnly": "O nome e o logotipo do servidor só podem ser alterados no computador que o executa.",
  "error.host.timezoneInvalid": "Este fuso horário não é conhecido.",
  "error.host.turnLimitInvalid": "Este limite de threads não é válido.",
  "error.host.maintenanceInterrupted":
    "A manutenção do computador anfitrião foi interrompida. Verifique o aplicativo e redefina o estado do computador anfitrião antes de tentar novamente.",
  "error.host.updateFailed":
    "A atualização do computador anfitrião falhou durante {phase}. Verifique a propriedade do pacote, a assinatura, o status dos ambientes de usuário e o espaço livre em disco antes de redefinir o estado.",
  "error.host.tenantsNotIdle":
    "Os ambientes de usuário não permaneceram ociosos por cinco minutos dentro de duas horas.",
  "error.host.tenantShutdownTimeout":
    "O tempo para encerrar o ambiente de usuário esgotou. Nenhuma substituição do aplicativo foi iniciada.",
  "error.host.tenantHealthMissing":
    "Os relatórios de integridade dos ambientes de usuário estão ausentes ou indicam falhas após a reinicialização. Verifique as sessões dos ambientes de usuário antes de outra atualização.",
  "error.host.personalityInvalid": "Este estilo de resposta não é conhecido.",
} as const satisfies PartialTranslation<typeof source>;
