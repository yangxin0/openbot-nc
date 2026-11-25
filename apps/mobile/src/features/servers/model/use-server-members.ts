import { canAdministerServer } from "@openbot/contracts/ipc";
import { useQuery } from "@tanstack/react-query";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import {
  canManageServerMember,
  type ServerMemberChange,
  sortServerMembers,
} from "@/features/servers/model/server-members";
import { useLockedMutation } from "@/features/servers/model/use-locked-action";
import { useMobileWorkspace, useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { showsOnline } from "@/features/workspace/model/server-status";

export function useServerMembers(serverId: string) {
  const { servers } = useMobileWorkspace();
  const { loadServerMembers, loadCurrentMember, updateServerMember, removeServerMember } = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const server = servers.find((candidate) => candidate.id === serverId);
  const online = showsOnline(server);
  const canManage = canAdministerServer(server?.role);
  const viewer = useQuery({
    queryKey: queryKeys.serverCurrentMember(queryScope, serverId),
    enabled: online,
    retry: false,
    gcTime: 0,
    queryFn: () => loadCurrentMember(serverId),
  });
  const members = useQuery({
    queryKey: queryKeys.serverMembers(queryScope, serverId),
    enabled: online && canManage,
    retry: false,
    gcTime: 0,
    queryFn: () => loadServerMembers(serverId),
  });
  const { action, perform } = useLockedMutation({
    success: () => {
      void members.refetch();
    },
  });
  const current = viewer.data ?? null;
  return {
    server,
    online,
    canManage,
    viewer: current,
    members,
    list: members.data ? sortServerMembers(members.data) : undefined,
    action,
    manages: (member: Parameters<typeof canManageServerMember>[1]) => canManageServerMember(current, member),
    change: (change: ServerMemberChange) => perform(() => updateServerMember(change, serverId).then(() => undefined)),
    remove: (memberId: string) => perform(() => removeServerMember(memberId, serverId)),
    refresh() {
      void viewer.refetch();
      void members.refetch();
    },
  };
}
