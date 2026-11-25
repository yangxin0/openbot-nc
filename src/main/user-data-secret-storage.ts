import { join } from "node:path";
import { sourceText } from "@openbot/i18n/source";
import { app } from "electron";
import {
  createSecretStorage,
  SECRET_STORAGE_KEY_FILE,
  type SecretStorage,
  type SecretStorageCipher,
} from "./secret-storage-cipher";

let userDataSecretStorage: SecretStorage | null = null;

export function secretStorage(): SecretStorage {
  userDataSecretStorage ??= createSecretStorage({
    keyPath: join(app.getPath("userData"), SECRET_STORAGE_KEY_FILE),
  });
  return userDataSecretStorage;
}

export function safeStorageCipher(
  unavailableKey: "error.app.secretStorageUnavailable" | "error.app.macSecureStorageUnavailable",
): SecretStorageCipher {
  return secretStorage().cipher(() => sourceText(unavailableKey));
}
