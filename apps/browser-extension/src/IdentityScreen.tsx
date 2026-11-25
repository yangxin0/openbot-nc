import { AppLogo } from "@openbot/brand";
import type { AppTextKey } from "@openbot/i18n";
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  Button,
  CircleAlert,
  Field,
  Input,
  KeyRound,
  Textarea,
  Upload,
} from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createStore, Show } from "solid-js";
import { type IdentitySource, identityErrorKey } from "./extension-identity";

const variant = import.meta.env.DEV ? "dev" : "production";

export function IdentityScreen(props: {
  error: AppTextKey | null;
  onImport: (source: IdentitySource) => Promise<void>;
}) {
  const { t } = useText();
  const [state, setState] = createStore<{ text: string; busy: "text" | "file" | null; error: AppTextKey | null }>({
    text: "",
    busy: null,
    error: null,
  });
  let fileInput: HTMLInputElement | undefined;
  const shownError = () => state.error ?? props.error;
  async function submit(source: IdentitySource): Promise<void> {
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
    <main class="account-login-screen">
      <div class="account-login-shell">
        <header class="account-login-brand-lockup">
          <AppLogo variant={variant} class="account-login-logo" />
        </header>
        <section
          class="account-login"
          aria-labelledby="extension-identity-title"
          aria-describedby="extension-identity-description"
        >
          <h1 id="extension-identity-title" class="account-login-title">
            {t("webClient.identity.title")}
          </h1>
          <p id="extension-identity-description" class="account-login-description">
            {t("extension.identity.description")}
          </p>
          <form
            class="account-login-form"
            onSubmit={(event) => {
              event.preventDefault();
              importText();
            }}
          >
            <Field label={t("webClient.identity.pasteLabel")} description={t("webClient.identity.privacy")}>
              <Textarea
                class="ext-identity-text"
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
            <Button
              type="submit"
              class="account-login-primary"
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
        </section>
      </div>
    </main>
  );
}
