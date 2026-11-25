import { router, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { Alert, View } from "react-native";
import { useUniwind } from "uniwind";
import { type ServerMemberRole, serverMemberName } from "@/features/servers/model/server-members";
import { SERVER_ROLE_LABEL_KEYS } from "@/features/servers/model/server-role";
import { useServerMembers } from "@/features/servers/model/use-server-members";
import { memberRoleNames, useServerRoles } from "@/features/servers/model/use-server-roles";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { SettingsPicker } from "@/features/settings/components/settings-controls";
import { ProfileAvatar } from "@/shared/components/profile-avatar";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

const DATE_FORMAT = { year: "numeric", month: "short", day: "numeric" } as const;

export function ServerMemberScreen() {
  const { t, format, errorMessage } = useText();
  const { theme } = useUniwind();
  const { serverId, memberId } = useLocalSearchParams<{ serverId: string; memberId: string }>();
  const { server, canManage, viewer, members, list, action, manages, change, remove } = useServerMembers(serverId);
  const roles = useServerRoles(serverId);
  const member = list?.find((candidate) => candidate.id === memberId);
  if (!server || !canManage || !member)
    return (
      <SettingsContent>
        <SettingsNote>
          {!server
            ? t("mobile.server.unavailable")
            : !canManage
              ? t("mobile.server.members.adminOnly")
              : members.isError
                ? errorMessage(members.error, t("mobile.server.members.loadFailed"))
                : members.isPending
                  ? t("mobile.server.members.loading")
                  : t("mobile.server.members.gone")}
        </SettingsNote>
      </SettingsContent>
    );
  const name = serverMemberName(member);
  const self = member.id === viewer?.id;
  const manageable = manages(member);
  const memberRoles = memberRoleNames(roles.list, member.id);
  const managedRole: ServerMemberRole = member.role === "admin" ? "admin" : "member";
  const confirmRemove = () =>
    Alert.alert(
      t("mobile.server.members.removeTitle", { name }),
      t("mobile.server.members.removeCertificateBody", { name, server: server.name }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("mobile.server.members.remove"),
          style: "destructive",
          onPress: () =>
            void remove(member.id).then((removed) => {
              if (removed) router.back();
            }),
        },
      ],
    );
  const toggleDisabled = () => {
    if (member.disabled) {
      void change({ memberId: member.id, disabled: false });
      return;
    }
    Alert.alert(
      t("mobile.server.members.disableTitle", { name }),
      t("mobile.server.members.disableBody", { name, server: server.name }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("mobile.server.members.disable"),
          style: "destructive",
          onPress: () => void change({ memberId: member.id, disabled: true }),
        },
      ],
    );
  };
  return (
    <SettingsContent>
      <View className="items-center gap-3">
        <ProfileAvatar neutral name={name} size={88} />
        <View className="items-center gap-1 self-stretch px-4">
          <Typography.Heading type="h4" align="center" numberOfLines={2}>
            {self ? t("mobile.server.members.you", { name }) : name}
          </Typography.Heading>
          {member.username !== name || member.disabled ? (
            <Typography.Paragraph selectable align="center" type="body-sm" className="text-grouped-secondary">
              {[
                member.username !== name ? member.username : null,
                member.disabled ? t("mobile.server.members.disabled") : null,
              ]
                .filter((part) => part !== null)
                .join(" · ")}
            </Typography.Paragraph>
          ) : null}
        </View>
      </View>
      <SettingsSection
        footer={
          manageable
            ? t("mobile.server.members.adminHint")
            : member.role === "owner"
              ? t("mobile.server.members.ownerHint")
              : undefined
        }
      >
        <SettingsRow
          disclosure={false}
          trailing={
            manageable && member.role !== "owner" ? (
              <SettingsPicker<ServerMemberRole>
                value={managedRole}
                options={[
                  { value: "member", label: t(SERVER_ROLE_LABEL_KEYS.member) },
                  { value: "admin", label: t(SERVER_ROLE_LABEL_KEYS.admin) },
                ]}
                enabled={!action.isPending}
                dark={theme === "dark"}
                label={t("mobile.server.members.role")}
                onChange={(value) => {
                  if (value === managedRole) return;
                  void haptics.selection();
                  void change({ memberId: member.id, role: value });
                }}
              />
            ) : (
              <Typography.Paragraph className="text-grouped-secondary">
                {t(SERVER_ROLE_LABEL_KEYS[member.role])}
              </Typography.Paragraph>
            )
          }
        >
          <Typography.Paragraph>{t("mobile.server.members.role")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow
          disclosure={false}
          trailing={
            <Typography.Paragraph className="text-grouped-secondary">
              {format.date(new Date(member.createdAt), DATE_FORMAT)}
            </Typography.Paragraph>
          }
        >
          <Typography.Paragraph>{t("mobile.server.members.joined")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      {action.error ? (
        <Typography.Paragraph accessibilityRole="alert" type="body-xs" className="-mt-4 px-4 text-danger-text">
          {errorMessage(action.error, t("mobile.server.members.updateFailed"))}
        </Typography.Paragraph>
      ) : null}
      {manageable && member.role === "member" && roles.available ? (
        <SettingsSection footer={t("mobile.server.roles.memberHint")}>
          <SettingsRow
            supportingText={
              roles.roles.isError
                ? errorMessage(roles.roles.error, t("mobile.server.roles.loadFailed"))
                : !roles.list
                  ? t("mobile.server.roles.loading")
                  : memberRoles.length
                    ? format.list(memberRoles)
                    : t("mobile.server.roles.memberNone")
            }
            onPress={() =>
              router.push({ pathname: "/server-settings/member-roles", params: { serverId, memberId: member.id } })
            }
          >
            <Typography.Paragraph>{t("mobile.server.roles.title")}</Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : null}
      {manageable ? (
        <SettingsSection footer={t("mobile.server.members.disabledHint")}>
          <SettingsRow disclosure={false} disabled={action.isPending} onPress={toggleDisabled}>
            <Typography.Paragraph className={member.disabled ? "text-accent" : "text-danger-text"}>
              {t(member.disabled ? "mobile.server.members.enable" : "mobile.server.members.disable")}
            </Typography.Paragraph>
          </SettingsRow>
          <SettingsRow disclosure={false} disabled={action.isPending} onPress={confirmRemove}>
            <Typography.Paragraph className="text-danger-text">
              {t("mobile.server.members.remove")}
            </Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : null}
    </SettingsContent>
  );
}
