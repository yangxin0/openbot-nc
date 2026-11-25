import { useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { useUniwind } from "uniwind";
import { serverMemberName } from "@/features/servers/model/server-members";
import { useServerMembers } from "@/features/servers/model/use-server-members";
import { setRoleMember, useServerRoles } from "@/features/servers/model/use-server-roles";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { SettingsSwitch } from "@/features/settings/components/settings-controls";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

export function ServerMemberRolesScreen() {
  const { t, errorMessage } = useText();
  const { theme } = useUniwind();
  const { serverId, memberId } = useLocalSearchParams<{ serverId: string; memberId: string }>();
  const { members, list: memberList } = useServerMembers(serverId);
  const { available, roles, action, list, save } = useServerRoles(serverId);
  const member = memberList?.find((candidate) => candidate.id === memberId);
  if (!available || !member || member.role !== "member" || !list)
    return (
      <SettingsContent>
        <SettingsNote>
          {!available
            ? t("mobile.server.roles.unavailable")
            : roles.isError
              ? errorMessage(roles.error, t("mobile.server.roles.loadFailed"))
              : members.isError
                ? errorMessage(members.error, t("mobile.server.members.loadFailed"))
                : !list || members.isPending
                  ? t("mobile.server.roles.loading")
                  : !member
                    ? t("mobile.server.members.gone")
                    : t("mobile.server.roles.memberAdmin")}
        </SettingsNote>
        {roles.isError ? (
          <SettingsSection>
            <SettingsRow disclosure={false} disabled={roles.isFetching} onPress={() => void roles.refetch()}>
              <Typography.Paragraph className="text-accent">{t("mobile.server.members.retry")}</Typography.Paragraph>
            </SettingsRow>
          </SettingsSection>
        ) : null}
      </SettingsContent>
    );
  return (
    <SettingsContent>
      <SettingsSection
        title={t("mobile.server.roles.memberTitle", { name: serverMemberName(member) })}
        footer={
          action.error
            ? errorMessage(action.error, t("mobile.server.roles.saveFailed"))
            : t("mobile.server.roles.memberHint")
        }
      >
        {list.length === 0 ? (
          <SettingsRow disclosure={false}>
            <Typography.Paragraph className="text-grouped-secondary">
              {t("mobile.server.roles.memberEmpty")}
            </Typography.Paragraph>
          </SettingsRow>
        ) : null}
        {list.map((role) => (
          <SettingsRow key={role.id}>
            <SettingsSwitch
              value={role.memberIds.includes(member.id)}
              disabled={action.isPending}
              label={role.name}
              dark={theme === "dark"}
              onValueChange={(on) => {
                void haptics.selection();
                void save((change) => setRoleMember(change, role.id, member.id, on));
              }}
            />
          </SettingsRow>
        ))}
      </SettingsSection>
    </SettingsContent>
  );
}
