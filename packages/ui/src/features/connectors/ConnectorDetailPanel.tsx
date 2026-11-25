import { Match, Switch } from "solid-js";
import type { TextValue } from "../../text";
import {
  BitwardenConnectorPanel,
  type BitwardenConnectorPanelProps,
  bitwardenStatus,
} from "../settings/BitwardenConnectorPanel";
import {
  type IntegrationAgent,
  type IntegrationPageSlots,
  type IntegrationStatus,
  UNKNOWN_STATUS,
} from "../settings/IntegrationLayout";
import {
  ONEPASSWORD_STATUS,
  OnePasswordConnectorPanel,
  type OnePasswordConnectorPanelProps,
} from "../settings/OnePasswordConnectorPanel";
import {
  ProtonPassConnectorPanel,
  type ProtonPassConnectorPanelProps,
  protonPassStatus,
} from "../settings/ProtonPassConnectorPanel";
import {
  messagingStateUnknown,
  WhatsAppIntegrationPanel,
  type WhatsAppIntegrationPanelProps,
  whatsappIntegrationState,
  whatsappOrchestrator,
} from "../settings/WhatsAppIntegrationPanel";

export type ConnectorDetail =
  | { id: "onepassword"; props: OnePasswordConnectorPanelProps }
  | { id: "bitwarden"; props: BitwardenConnectorPanelProps }
  | { id: "protonpass"; props: ProtonPassConnectorPanelProps }
  | { id: "whatsapp"; props: WhatsAppIntegrationPanelProps };

export interface ConnectorSummary {
  status: IntegrationStatus;
  statusLabel: string;
  summary: string;
  agents?: IntegrationAgent[] | undefined;
}

function unknownSummary(t: TextValue["t"]): ConnectorSummary {
  return { status: UNKNOWN_STATUS.status, statusLabel: t(UNKNOWN_STATUS.label), summary: t("connector.readFailed") };
}

export function connectorSummary(detail: ConnectorDetail, t: TextValue["t"]): ConnectorSummary {
  switch (detail.id) {
    case "onepassword": {
      if (detail.props.statusError) return unknownSummary(t);
      const status = detail.props.status;
      const header = ONEPASSWORD_STATUS[status.state];
      const host = detail.props.hostName;
      return {
        status: header.status,
        statusLabel: t(header.label),
        summary:
          status.state === "connected" && status.loginCount !== null
            ? t("connector.onePassword.loginCount", { count: status.loginCount })
            : host
              ? t("connector.onePassword.descriptionHost", { host })
              : t("connector.onePassword.description"),
      };
    }
    case "bitwarden": {
      if (detail.props.statusError) return unknownSummary(t);
      const header = bitwardenStatus(detail.props);
      const host = detail.props.hostName;
      return {
        status: header.status,
        statusLabel: t(header.label),
        summary: host ? t("connector.bitwarden.descriptionHost", { host }) : t("connector.bitwarden.description"),
      };
    }
    case "protonpass": {
      if (detail.props.statusError) return unknownSummary(t);
      const status = detail.props.status;
      const header = protonPassStatus(detail.props);
      const host = detail.props.hostName;
      return {
        status: header.status,
        statusLabel: t(header.label),
        summary:
          header.status === "attention"
            ? t("connector.protonPass.expiredTitle")
            : status.state === "connected" && status.loginCount !== null
              ? t("connector.protonPass.loginCount", { count: status.loginCount })
              : host
                ? t("connector.protonPass.descriptionHost", { host })
                : t("connector.protonPass.description"),
      };
    }
    case "whatsapp": {
      if (messagingStateUnknown(detail.props)) return unknownSummary(t);
      const { connections, agents } = detail.props;
      const state = whatsappIntegrationState(connections, agents);
      const orchestrator = whatsappOrchestrator(connections, agents);
      const count = connections.length;
      return {
        status: state.status,
        statusLabel: t(state.label),
        summary:
          state.attention > 0
            ? t("connector.whatsapp.attentionTitle", { count: state.attention })
            : count === 0
              ? t("connector.whatsapp.description")
              : orchestrator
                ? t("connector.whatsapp.summaryConnected", { count })
                : t("connector.whatsapp.summaryNoAgent", { count }),
        agents: orchestrator ? [orchestrator] : [],
      };
    }
  }
}

export function connectorDescription(detail: ConnectorDetail, t: TextValue["t"]): string {
  switch (detail.id) {
    case "onepassword": {
      const host = detail.props.hostName;
      return host ? t("connector.onePassword.descriptionHost", { host }) : t("connector.onePassword.description");
    }
    case "bitwarden": {
      const host = detail.props.hostName;
      return host ? t("connector.bitwarden.descriptionHost", { host }) : t("connector.bitwarden.description");
    }
    case "protonpass": {
      const host = detail.props.hostName;
      return host ? t("connector.protonPass.descriptionHost", { host }) : t("connector.protonPass.description");
    }
    case "whatsapp":
      return t("connector.whatsapp.description");
  }
}

export function ConnectorDetailPanel(props: { detail: ConnectorDetail } & IntegrationPageSlots) {
  const onePassword = () => (props.detail.id === "onepassword" ? props.detail : undefined);
  const bitwarden = () => (props.detail.id === "bitwarden" ? props.detail : undefined);
  const protonPass = () => (props.detail.id === "protonpass" ? props.detail : undefined);
  const whatsapp = () => (props.detail.id === "whatsapp" ? props.detail : undefined);
  return (
    <Switch>
      <Match when={onePassword()}>
        {(detail) => (
          <OnePasswordConnectorPanel
            {...detail().props}
            tagline={props.tagline}
            intro={props.intro}
            details={props.details}
          />
        )}
      </Match>
      <Match when={bitwarden()}>
        {(detail) => (
          <BitwardenConnectorPanel
            {...detail().props}
            tagline={props.tagline}
            intro={props.intro}
            details={props.details}
          />
        )}
      </Match>
      <Match when={protonPass()}>
        {(detail) => (
          <ProtonPassConnectorPanel
            {...detail().props}
            tagline={props.tagline}
            intro={props.intro}
            details={props.details}
          />
        )}
      </Match>
      <Match when={whatsapp()}>
        {(detail) => (
          <WhatsAppIntegrationPanel
            {...detail().props}
            tagline={props.tagline}
            intro={props.intro}
            details={props.details}
          />
        )}
      </Match>
    </Switch>
  );
}
