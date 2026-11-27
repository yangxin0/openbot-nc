import { AppLogo } from "@openbot/brand";
import type { AppAppearance } from "@openbot/contracts/app-appearance";
import { APP_NAME } from "@openbot/contracts/app-identity";
import type { AppVariant } from "@openbot/contracts/ipc";
import type { AppTextKey, TranslatedLocale } from "@openbot/i18n";
import { appLanguageOption } from "@openbot/i18n/languages";
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  Button,
  ChevronDown,
  CircleAlert,
  Field,
  FileText,
  Globe2,
  IconButton,
  Input,
  KeyRound,
  Monitor,
  Moon,
  Sun,
  Textarea,
  Upload,
} from "@openbot/ui";
import { RelayJoinCodeForm } from "@openbot/ui/features/settings/RelayJoinCode";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { createStore, Show } from "solid-js";
import { identityErrorKey } from "./web-relay";

export type WebIdentitySource = { text: string } | { file: File };

const FILE_PANEL_ID = "web-identity-file-panel";

export function WebIdentityScreen(props: {
  variant: AppVariant;
  language: TranslatedLocale;
  appearance: AppAppearance;
  error: AppTextKey | null;
  onImport: (source: WebIdentitySource) => Promise<void>;
  onJoin: (code: string) => Promise<void>;
  onChangeLanguage: () => void;
  onChangeAppearance: (appearance: AppAppearance) => void;
}) {
  const { t } = useText();
  const [state, setState] = createStore<{
    text: string;
    busy: "text" | "file" | "code" | null;
    error: AppTextKey | null;
    joinError: AppTextKey | null;
    fileOpen: boolean;
  }>({
    text: "",
    busy: null,
    error: null,
    joinError: null,
    fileOpen: false,
  });
  let fileInput: HTMLInputElement | undefined;
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
        draft.fileOpen = true;
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
    <main class="account-login-screen web-identity" aria-labelledby="web-identity-title">
      <div class="account-login-shell web-identity-shell">
        <header class="account-login-brand-lockup">
          <AppLogo variant={props.variant} animation="blink" interactive class="account-login-logo" />
          <span class="account-login-wordmark">{APP_NAME}</span>
        </header>
        <section class="account-login web-identity-panel">
          <h1 id="web-identity-title">{t("webClient.identity.title")}</h1>
          <p class="account-login-description">{t("webClient.identity.description")}</p>
          <Show when={props.error}>{(key) => <IdentityAlert text={t(key())} />}</Show>
          <RelayJoinCodeForm
            busy={state.busy === "code"}
            disabled={state.busy !== null && state.busy !== "code"}
            error={state.joinError ? t(state.joinError) : null}
            onJoin={(code) => void join(code)}
          />
          <div class="web-identity-file">
            <Button
              type="button"
              class="web-identity-file-toggle"
              variant="ghost"
              size="sm"
              aria-expanded={state.fileOpen ? "true" : "false"}
              aria-controls={FILE_PANEL_ID}
              onClick={() =>
                setState((draft) => {
                  draft.fileOpen = !draft.fileOpen;
                })
              }
            >
              <FileText aria-hidden="true" />
              {t("webClient.identity.fileOption")}
              <ChevronDown class="web-identity-file-chevron" aria-hidden="true" />
            </Button>
            <form
              id={FILE_PANEL_ID}
              class="web-identity-form"
              hidden={!state.fileOpen}
              onSubmit={(event) => {
                event.preventDefault();
                importText();
              }}
            >
              <Field label={t("webClient.identity.pasteLabel")} description={t("webClient.identity.privacy")}>
                <Textarea
                  class="web-identity-text"
                  rows={5}
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
              <Show when={state.error}>{(key) => <IdentityAlert text={t(key())} />}</Show>
              <div class="web-connect-primary-actions">
                <Button
                  type="submit"
                  variant="secondary"
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
            </form>
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
          </div>
        </section>
      </div>
      <footer class="web-identity-footer">
        <Button
          type="button"
          class="web-identity-language"
          variant="ghost"
          size="sm"
          lang={appLanguageOption(props.language).lang}
          title={t("account.language.change")}
          onClick={() => props.onChangeLanguage()}
        >
          <Globe2 aria-hidden="true" />
          {appLanguageOption(props.language).label}
        </Button>
        <fieldset class="web-identity-theme" aria-label={t("settings.appearance.theme.title")}>
          <ThemeChoice
            value="system"
            label={t("settings.appearance.theme.system")}
            current={props.appearance}
            onChoose={props.onChangeAppearance}
          >
            <Monitor aria-hidden="true" />
          </ThemeChoice>
          <ThemeChoice
            value="light"
            label={t("settings.appearance.theme.light")}
            current={props.appearance}
            onChoose={props.onChangeAppearance}
          >
            <Sun aria-hidden="true" />
          </ThemeChoice>
          <ThemeChoice
            value="dark"
            label={t("settings.appearance.theme.dark")}
            current={props.appearance}
            onChoose={props.onChangeAppearance}
          >
            <Moon aria-hidden="true" />
          </ThemeChoice>
        </fieldset>
      </footer>
    </main>
  );
}

function ThemeChoice(props: {
  value: AppAppearance;
  label: string;
  current: AppAppearance;
  onChoose: (appearance: AppAppearance) => void;
  children: JSX.Element;
}) {
  return (
    <IconButton
      class="web-identity-theme-choice"
      label={props.label}
      variant="ghost"
      size="icon-xs"
      aria-pressed={props.current === props.value ? "true" : "false"}
      onClick={() => props.onChoose(props.value)}
    >
      {props.children}
    </IconButton>
  );
}

function IdentityAlert(props: { text: string }) {
  return (
    <Alert class="web-identity-alert" tone="danger" role="alert" report={false}>
      <AlertIcon>
        <CircleAlert />
      </AlertIcon>
      <AlertContent>
        <AlertDescription>{props.text}</AlertDescription>
      </AlertContent>
    </Alert>
  );
}
