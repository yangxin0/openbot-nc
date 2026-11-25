import { createNobleRelayCrypto } from "@openbot/team-client/relay-crypto-noble";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { createPhoneIdentityStore, type PhoneSecureStore } from "./phone-identity";

const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainService: "openbot.relay-identity",
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

const phoneSecureStore: PhoneSecureStore = {
  getItemAsync: (key) => SecureStore.getItemAsync(key, SECURE_OPTIONS),
  setItemAsync: (key, value) => SecureStore.setItemAsync(key, value, SECURE_OPTIONS),
  deleteItemAsync: (key) => SecureStore.deleteItemAsync(key, SECURE_OPTIONS),
};

export const phoneRelayCrypto = createNobleRelayCrypto({ randomBytes: (size) => Crypto.getRandomBytes(size) });

export const phoneIdentityStore = createPhoneIdentityStore(phoneSecureStore, phoneRelayCrypto);
