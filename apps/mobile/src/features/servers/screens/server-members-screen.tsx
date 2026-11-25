import { router, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { serverMemberName } from "@/features/servers/model/server-members";
import { SERVER_ROLE_LABEL_KEYS } from "@/features/servers/model/server-role";
import { useServerMembers } from "@/features/servers/model/use-server-members";
import { memberRoleNames, useServerRoles } from "@/features/servers/model/use-server-roles";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { ProfileAvatar } from "@/shared/components/profile-avatar";
import { useText } from "@/shared/lib/text";

export function ServerMembersScreen() {
  const { t, errorMessage } = useText();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const { server, online, canManage, viewer, members, list, refresh } = useServerMembers(serverId);
  const roles = useServerRoles(serverId);
  if (!server || !online || !canManage)
    return (
      <SettingsContent>
        <SettingsNote>
          {!server
            ? t("mobile.server.unavailable")
            : !online
              ? t("mobile.server.members.offline")
              : t("mobile.server.members.adminOnly")}
        </SettingsNote>
      </SettingsContent>
    );
  return (
    <SettingsContent>
      <SettingsSection
        footer={members.isError ? errorMessage(members.error, t("mobile.server.members.loadFailed")) : undefined}
      >
        {members.isPending && !members.isError ? (
          <SettingsRow disclosure={false}>
            <Typography.Paragraph className="text-grouped-secondary">
              {t("mobile.server.members.loading")}
            </Typography.Paragraph>
          </SettingsRow>
        ) : null}
        {list?.map((member) => {
          const name = serverMemberName(member);
          const customRoles = member.role === "member" ? memberRoleNames(roles.list, member.id) : [];
          const roleName = customRoles.length > 0 ? customRoles.join(" · ") : t(SERVER_ROLE_LABEL_KEYS[member.role]);
          const role = member.disabled ? t("mobile.server.members.disabled") : roleName;
          return (
            <SettingsRow
              key={member.id}
              disclosure={false}
              leading={<ProfileAvatar neutral name={name} size={36} />}
              trailing={<Typography.Paragraph className="text-grouped-secondary">{role}</Typography.Paragraph>}
              accessibilityLabel={t("mobile.server.members.rowLabel", { name, role })}
              onPress={() =>
                router.push({ pathname: "/server-settings/member", params: { serverId, memberId: member.id } })
              }
            >
              <Typography.Paragraph numberOfLines={1}>
                {member.id === viewer?.id ? t("mobile.server.members.you", { name }) : name}
              </Typography.Paragraph>
            </SettingsRow>
          );
        })}
        {members.isSuccess && list?.length === 0 ? (
          <SettingsRow disclosure={false}>
            <Typography.Paragraph className="text-grouped-secondary">
              {t("mobile.server.members.empty")}
            </Typography.Paragraph>
          </SettingsRow>
        ) : null}
        {members.isError ? (
          <SettingsRow disclosure={false} disabled={members.isFetching} onPress={refresh}>
            <Typography.Paragraph className="text-accent">{t("mobile.server.members.retry")}</Typography.Paragraph>
          </SettingsRow>
        ) : null}
      </SettingsSection>
    </SettingsContent>
  );
}
