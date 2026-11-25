import { join } from "node:path";
import { app } from "electron";
import { CentralAuthManager } from "./central-auth-manager";
import type { LocalProfileStore } from "./local-profile-store";
import { safeStorageCipher, secretStorage } from "./user-data-secret-storage";

const CENTRAL_AUTH_FILE = "openbot-central-auth-v1.bin";

const REMOVED_ACCOUNT_SERVICE_URL = "https://account-service.invalid";

export function createCentralAuthManager(options: {
  confirmSessionAtStart: boolean;
  localProfile: LocalProfileStore;
}): CentralAuthManager {
  return new CentralAuthManager({
    apiUrl: REMOVED_ACCOUNT_SERVICE_URL,
    storagePath: join(app.getPath("userData"), CENTRAL_AUTH_FILE),
    ...safeStorageCipher("error.app.macSecureStorageUnavailable"),
    keyringChanged: () => secretStorage().madeKeyFile(),
    confirmSessionAtStart: options.confirmSessionAtStart,
    localProfile: options.localProfile,
  });
}
