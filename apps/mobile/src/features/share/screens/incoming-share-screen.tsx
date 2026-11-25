import { Redirect, router, useNavigation } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { isAndroid } from "@/shared/lib/platform";
import { discardWaitingShare, hasIncomingShare } from "../model/incoming-share";
import { holdShareSheet, openShareSheet, releaseShareSheet } from "../model/share-sheet-opener";

export function IncomingShareScreen() {
  const { session } = useMobileSession();
  const [waiting] = useState(hasIncomingShare);
  const opened = useRef(false);
  const signedIn = Boolean(session);
  const navigation = useNavigation();
  useEffect(() => {
    if (!isAndroid) return;
    holdShareSheet();
    return releaseShareSheet;
  }, []);
  useEffect(() => {
    if (!signedIn && waiting) discardWaitingShare();
  }, [signedIn, waiting]);
  useEffect(() => {
    if (!signedIn || opened.current) return;
    opened.current = true;
    if (isAndroid) {
      if (waiting) openShareSheet();
      if (navigation.canGoBack()) navigation.goBack();
      else router.dismissTo("/connected");
      return;
    }
    router.dismissTo("/connected");
    if (waiting) openShareSheet();
  }, [signedIn, waiting, navigation]);

  if (session) return null;
  return <Redirect href="/" />;
}
