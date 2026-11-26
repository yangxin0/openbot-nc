import { Button, ConfirmDialog, Field, Input, KeyRound } from "@openbot/ui";
import { createEffect, createStore } from "solid-js";
import { useText } from "../../text";

export interface RelayJoinCodeFormProps {
  busy: boolean;
  disabled?: boolean;
  error: string | null;
  code?: string;
  onJoin: (code: string) => void;
}

export interface RelayJoinCodeDialogProps {
  open: boolean;
  code: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onJoin: (code: string) => Promise<unknown>;
}

interface JoinCodeDraft {
  code: string;
  empty: boolean;
}

function createJoinCodeDraft(initial: () => string) {
  const [draft, setDraft] = createStore<JoinCodeDraft>({ code: initial(), empty: false });
  createEffect(initial, (code) => {
    setDraft((state) => {
      state.code = code;
      state.empty = false;
    });
  });
  return {
    draft,
    edit(code: string) {
      setDraft((state) => {
        state.code = code;
        state.empty = false;
      });
    },
    take(): string | null {
      const code = draft.code.trim();
      if (code === "") {
        setDraft((state) => {
          state.empty = true;
        });
        return null;
      }
      return code;
    },
  };
}

export function RelayJoinCodeForm(props: RelayJoinCodeFormProps) {
  const { t } = useText();
  const join = createJoinCodeDraft(() => props.code ?? "");
  return (
    <form
      class="relay-join-form"
      onSubmit={(event) => {
        event.preventDefault();
        const code = join.take();
        if (code !== null) props.onJoin(code);
      }}
    >
      <Field
        label={t("settings.team.join.label")}
        description={t("settings.team.join.description")}
        error={join.draft.empty ? t("settings.team.join.empty") : (props.error ?? undefined)}
      >
        <Input
          type="text"
          autocomplete="off"
          autocapitalize="off"
          spellcheck={false}
          placeholder={t("settings.team.join.placeholder")}
          value={join.draft.code}
          disabled={props.busy || props.disabled === true}
          onInput={(event) => join.edit(event.currentTarget.value)}
        />
      </Field>
      <Button
        type="submit"
        class="relay-join-submit"
        loading={props.busy}
        loadingLabel={t("settings.team.join.joining")}
        disabled={props.disabled === true}
      >
        <KeyRound aria-hidden="true" />
        {t("settings.team.join.action")}
      </Button>
    </form>
  );
}

export function RelayJoinCodeDialog(props: RelayJoinCodeDialogProps) {
  const { t } = useText();
  const join = createJoinCodeDraft(() => (props.open ? props.code : ""));
  return (
    <ConfirmDialog
      open={props.open}
      tone="default"
      icon={<KeyRound />}
      initialFocus="field"
      title={t("settings.team.join.title")}
      description={t("settings.team.join.description")}
      confirmLabel={t("settings.team.join.action")}
      pendingLabel={t("settings.team.join.joining")}
      pending={props.busy}
      error={props.error ?? undefined}
      onCancel={() => props.onCancel()}
      onConfirm={async () => {
        const code = join.take();
        if (code !== null) await props.onJoin(code);
      }}
    >
      <Field label={t("settings.team.join.label")} error={join.draft.empty ? t("settings.team.join.empty") : undefined}>
        <Input
          type="text"
          autocomplete="off"
          autocapitalize="off"
          spellcheck={false}
          placeholder={t("settings.team.join.placeholder")}
          value={join.draft.code}
          disabled={props.busy}
          onInput={(event) => join.edit(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || props.busy) return;
            event.preventDefault();
            const code = join.take();
            if (code !== null) void props.onJoin(code);
          }}
        />
      </Field>
    </ConfirmDialog>
  );
}
