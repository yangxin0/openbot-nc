import { AppLogo } from "@openbot/brand";
import type { AppVariant } from "@openbot/contracts/ipc";
import type { AppTextKey, TranslatedLocale } from "@openbot/i18n";
import { appLanguageOption } from "@openbot/i18n/languages";
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  Button,
  CircleAlert,
  Field,
  Globe2,
  Heading,
  Input,
  KeyRound,
  Text,
  Textarea,
  Upload,
} from "@openbot/ui";
import { RelayJoinCodeForm } from "@openbot/ui/features/settings/RelayJoinCode";
import { useText } from "@openbot/ui/text";
import { createStore, Show } from "solid-js";
import { identityErrorKey } from "./web-relay";

export type WebIdentitySource = { text: string } | { file: File };

export function WebIdentityScreen(props: {
  variant: AppVariant;
  language: TranslatedLocale;
  error: AppTextKey | null;
  onImport: (source: WebIdentitySource) => Promise<void>;
  onJoin: (code: string) => Promise<void>;
  onChangeLanguage: () => void;
}) {
  const { t } = useText();
  const [state, setState] = createStore<{
    text: string;
    busy: "text" | "file" | "code" | null;
    error: AppTextKey | null;
    joinError: AppTextKey | null;
  }>({
    text: "",
    busy: null,
    error: null,
    joinError: null,
  });
  let fileInput: HTMLInputElement | undefined;
  const shownError = () => state.error ?? props.error;
  async function submit(source: WebIdentitySource): Promise<void> {
    setState((draft) => {
      draft.busy = "text" in source ? "text" : "file";
      draft.error = null;
    });
    try {
      await props.onImport(source);
    } catch (error) {
      setState((draft) => {
        draft.error = identityErrorKey(error);
      });
    } finally {
      setState((draft) => {
        draft.busy = null;
      });
    }
  }
  async function join(code: string): Promise<void> {
    setState((draft) => {
      draft.busy = "code";
      draft.error = null;
      draft.joinError = null;
    });
    try {
      await props.onJoin(code);
    } catch (error) {
      setState((draft) => {
        draft.joinError = identityErrorKey(error);
      });
    } finally {
      setState((draft) => {
        draft.busy = null;
      });
    }
  }
  function importText(): void {
    const text = state.text.trim();
    if (!text) {
      setState((draft) => {
        draft.error = "webClient.identity.empty";
      });
      return;
    }
    void submit({ text });
  }
  return (
    <main class="web-identity" aria-labelledby="web-identity-title">
      <div class="web-connect-card">
        <header class="web-connect-header">
          <AppLogo variant={props.variant} class="web-connect-logo" />
          <Heading as="h1" size="lg" id="web-identity-title">
            {t("webClient.identity.title")}
          </Heading>
          <Text tone="muted">{t("webClient.identity.description")}</Text>
        </header>
        <RelayJoinCodeForm
          busy={state.busy === "code"}
          disabled={state.busy !== null && state.busy !== "code"}
          error={state.joinError ? t(state.joinError) : null}
          onJoin={(code) => void join(code)}
        />
        <Text class="web-identity-or" tone="muted" variant="caption">
          {t("webClient.identity.fileOption")}
        </Text>
        <form
          class="web-identity-form"
          onSubmit={(event) => {
            event.preventDefault();
            importText();
          }}
        >
          <Field label={t("webClient.identity.pasteLabel")} description={t("webClient.identity.privacy")}>
            <Textarea
              class="web-identity-text"
              rows={6}
              spellcheck={false}
              autocomplete="off"
              value={state.text}
              disabled={state.busy !== null}
              onInput={(event) => {
                const value = event.currentTarget.value;
                setState((draft) => {
                  draft.text = value;
                  draft.error = null;
                });
              }}
            />
          </Field>
          <Show when={shownError()}>
            {(key) => (
              <Alert tone="danger" role="alert" report={false}>
                <AlertIcon>
                  <CircleAlert />
                </AlertIcon>
                <AlertContent>
                  <AlertDescription>{t(key())}</AlertDescription>
                </AlertContent>
              </Alert>
            )}
          </Show>
          <div class="web-connect-primary-actions">
            <Button
              type="submit"
              loading={state.busy === "text"}
              loadingLabel={t("settings.team.importing")}
              disabled={state.busy !== null}
            >
              <KeyRound aria-hidden="true" />
              {t("webClient.identity.import")}
            </Button>
            <Button
              type="button"
              variant="outline"
              loading={state.busy === "file"}
              loadingLabel={t("settings.team.importing")}
              disabled={state.busy !== null}
              onClick={() => fileInput?.click()}
            >
              <Upload aria-hidden="true" />
              {t("webClient.identity.chooseFile")}
            </Button>
          </div>
          <Input
            ref={(element: HTMLInputElement) => {
              fileInput = element;
            }}
            hidden
            type="file"
            accept="application/json,.json"
            aria-label={t("webClient.identity.chooseFile")}
            onChange={(event: Event & { currentTarget: HTMLInputElement }) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void submit({ file });
            }}
          />
        </form>
        <Button
          type="button"
          class="web-identity-language"
          variant="ghost"
          size="sm"
          lang={appLanguageOption(props.language).lang}
          title={t("account.language.change")}
          onClick={() => props.onChangeLanguage()}
        >
          <Globe2 size={14} aria-hidden="true" />
          {appLanguageOption(props.language).label}
        </Button>
      </div>
    </main>
  );
}
