import { githubSkillUrl, type InstalledSkill } from "@openbot/contracts/ipc";
import {
  Button,
  ChevronRight,
  ExternalLink,
  Heading,
  IconButton,
  Input,
  Plus,
  RefreshCw,
  Search,
  Text,
} from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { createMemo, createStore, For, Match, onSettled, Show, Switch } from "solid-js";
import { DialogAgents, type DialogSkill } from "./MarketplaceAgentsDialog";
import { SkillMark } from "./MarketplaceParts";
import { createGithubRead, GithubTrustNote, githubLinkOf, githubListings } from "./marketplace-github";
import type { MarketplaceModel } from "./marketplace-model";
import { agentsWith, matches, outdated, userSkills, useSkillWords } from "./marketplace-skill-state";
import type { MarketplaceNavigation, MarketplaceScope } from "./marketplace-view";

const GROUP_LIMIT = 6;
const PAGE_SIZE = 24;

function createSkillRows(scope: MarketplaceScope) {
  const all = createMemo(() => userSkills(scope.model));
  const mine = createMemo(() =>
    all().filter((skill) => matches(scope.nav.state.query, `${skill.name} ${skill.description ?? ""}`)),
  );
  const open = (skillId: string) => scope.nav.go({ kind: "localSkill", skillId });
  return { all, mine, open };
}
type SkillRows = ReturnType<typeof createSkillRows>;

function UpdateButton(props: { model: MarketplaceModel; skill: DialogSkill }) {
  const { t } = useText();
  const old = () =>
    agentsWith(props.model, props.skill.id).filter((agent) =>
      outdated(props.model.installedSkill(agent.id, props.skill.id)),
    );
  return (
    <Show when={old().length > 0}>
      <IconButton
        type="button"
        variant="outline"
        label={t("skill.updateName", { name: props.skill.name })}
        disabled={props.model.skillBusy(props.skill.id)}
        onClick={() =>
          void props.model.updateSkill(
            props.skill,
            old().map((agent) => agent.id),
          )
        }
      >
        <RefreshCw aria-hidden="true" />
      </IconButton>
    </Show>
  );
}

function LibraryRow(props: {
  name: string;
  iconUrl: string | null | undefined;
  line: string | undefined;
  fallback: string;
  onOpen: () => void;
  children: JSX.Element;
}) {
  const { t } = useText();
  const mark = () => ({ iconUrl: props.iconUrl ?? null });
  return (
    <li class="marketplace-app-row marketplace-skill-row">
      <Button
        type="button"
        variant="ghost"
        class="marketplace-app-row-hit"
        aria-label={t("marketplace.open", { name: props.name })}
        onClick={props.onOpen}
      />
      <SkillMark skill={mark()} size="md" />
      <span class="marketplace-app-row-copy">
        <span class="marketplace-skill-name">
          <span class="marketplace-app-row-name">{props.name}</span>
        </span>
        <span class={{ "marketplace-app-row-tagline": true, "marketplace-skill-attention": props.line !== undefined }}>
          {props.line ?? props.fallback}
        </span>
      </span>
      <span class="marketplace-app-row-status marketplace-skill-row-actions">{props.children}</span>
    </li>
  );
}

function OwnRows(props: { scope: MarketplaceScope; rows: SkillRows; skills: readonly InstalledSkill[] }) {
  const words = useSkillWords(() => props.scope.model);
  return (
    <ul class="marketplace-app-list marketplace-skill-list">
      <For each={props.skills} keyed={(skill) => skill.skillId}>
        {(skill) => (
          <LibraryRow
            name={skill().name}
            iconUrl={null}
            line={words.stateOn(skill().skillId)}
            fallback={words.restingLine(skill())}
            onOpen={() => props.rows.open(skill().skillId)}
          >
            <UpdateButton model={props.scope.model} skill={{ id: skill().skillId, name: skill().name }} />
            <DialogAgents
              model={props.scope.model}
              skill={{ id: skill().skillId, name: skill().name, iconUrl: null }}
            />
          </LibraryRow>
        )}
      </For>
    </ul>
  );
}

export function MarketplaceSearch(props: {
  nav: MarketplaceNavigation;
  label?: string | undefined;
  placeholder?: string | undefined;
}) {
  const { t } = useText();
  const label = () => props.label ?? t("marketplace.search.label");
  const placeholder = () => props.placeholder ?? props.label ?? t("marketplace.search.placeholder");
  return (
    <label class="search-field marketplace-search">
      <Search aria-hidden="true" />
      <Input
        type="search"
        aria-label={label()}
        placeholder={placeholder()}
        value={props.nav.state.query}
        onInput={(event) => {
          const value = event.currentTarget.value;
          props.nav.set((draft) => {
            draft.query = value;
          });
        }}
      />
    </label>
  );
}

export function GroupHead(props: {
  id: string;
  label: string;
  count?: number | undefined;
  more: boolean;
  onSeeAll: () => void;
}) {
  const { t, format } = useText();
  return (
    <div class="marketplace-skill-group-head">
      <h4 id={props.id} class="marketplace-app-group-title">
        {props.label}
        <Show when={props.count}>
          {(count) => <span class="marketplace-app-group-count">{format.number(count())}</span>}
        </Show>
      </h4>
      <Show when={props.more}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={t("marketplace.skills.seeAllName", { name: props.label })}
          onClick={props.onSeeAll}
        >
          {t("marketplace.skills.seeAll")}
          <ChevronRight aria-hidden="true" />
        </Button>
      </Show>
    </div>
  );
}

function NoSkills() {
  const { t } = useText();
  return (
    <div class="marketplace-skill-empty">
      <SkillMark skill={{ iconUrl: null }} size="md" />
      <div>
        <Text as="p" variant="body">
          {t("marketplace.skills.none")}
        </Text>
        <Text as="p" variant="body-sm" tone="muted">
          {t("marketplace.skills.noneHint")}
        </Text>
      </div>
    </div>
  );
}

function CreateSkill(props: { model: MarketplaceModel }) {
  const { t } = useText();
  const create = () => (props.model.agents().length > 0 ? props.model.createSkill : undefined);
  return (
    <Show when={create()}>
      {(create) => (
        <Button type="button" size="sm" variant="outline" onClick={() => create()(props.model.activeAgentId())}>
          <Plus aria-hidden="true" />
          {t("skill.toolbar.create")}
        </Button>
      )}
    </Show>
  );
}

function GithubSkills(props: { scope: MarketplaceScope; link: string }) {
  const { t } = useText();
  const model = () => props.scope.model;
  const read = createGithubRead(model, () => props.link);
  const found = () => {
    const value = read();
    return value !== null && value !== "reading" && value.status === "found" ? value.source : null;
  };
  const failed = () => {
    const value = read();
    return value !== null && value !== "reading" && value.status === "failed" ? value.message : null;
  };
  const repository = (owner: string, repo: string) => `${owner}/${repo}`;
  return (
    <section class="marketplace-app-group marketplace-github" aria-labelledby="marketplace-skills-github">
      <Switch>
        <Match when={failed()}>
          {(message) => (
            <div class="marketplace-empty" role="alert">
              <Text as="p" variant="body-sm" tone="muted" id="marketplace-skills-github">
                {message()}
              </Text>
            </div>
          )}
        </Match>
        <Match when={found()}>
          {(source) => (
            <>
              <div class="marketplace-skill-group-head">
                <h4 id="marketplace-skills-github" class="marketplace-app-group-title">
                  {repository(source().owner, source().repo)}
                  <span class="marketplace-app-group-count">{source().skills.length}</span>
                </h4>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={t("marketplace.skills.github.openName", {
                    repository: repository(source().owner, source().repo),
                  })}
                  onClick={() => model().openUrl(githubSkillUrl(source()))}
                >
                  {t("marketplace.skills.github.open")}
                  <ExternalLink aria-hidden="true" />
                </Button>
              </div>
              <GithubTrustNote />
              <ul class="marketplace-app-list marketplace-skill-list">
                <For each={githubListings(source())} keyed={(skill) => skill.id}>
                  {(skill) => (
                    <LibraryRow
                      name={skill().name}
                      iconUrl={null}
                      line={undefined}
                      fallback={skill().description}
                      onOpen={() => props.scope.nav.go({ kind: "skill", listing: skill() })}
                    >
                      <DialogAgents model={model()} skill={skill()} />
                    </LibraryRow>
                  )}
                </For>
              </ul>
            </>
          )}
        </Match>
        <Match when={read() === "reading"}>
          <Text as="p" variant="body-sm" tone="muted" role="status" id="marketplace-skills-github">
            {t("marketplace.skills.github.reading")}
          </Text>
        </Match>
      </Switch>
    </section>
  );
}

export function SkillLibrary(props: { scope: MarketplaceScope; noMatch: JSX.Element }) {
  const { t } = useText();
  const nav = () => props.scope.nav;
  const model = () => props.scope.model;
  const rows = createSkillRows(props.scope);
  const githubLink = () => githubLinkOf(model(), nav().state.query);
  const searchHint = () => (model().readGithubSkills ? t("marketplace.skills.github.search") : undefined);

  return (
    <div class="marketplace-view marketplace-browse">
      <header class="marketplace-browse-head">
        <div class="marketplace-skill-head-row">
          <div class="marketplace-browse-copy">
            <Heading as="h3" size="lg" class="marketplace-browse-title">
              {t("marketplace.tab.skills")}
            </Heading>
            <Text as="p" variant="body" tone="muted">
              {t("marketplace.description.skills")}
            </Text>
          </div>
        </div>
        <div class="marketplace-toolbar">
          <MarketplaceSearch nav={nav()} placeholder={searchHint()} />
          <CreateSkill model={model()} />
        </div>
      </header>
      <Show when={githubLink()} fallback={<SkillCatalog scope={props.scope} rows={rows} noMatch={props.noMatch} />}>
        {(link) => (
          <div class="marketplace-stack">
            <GithubSkills scope={props.scope} link={link()} />
          </div>
        )}
      </Show>
    </div>
  );
}

function SkillCatalog(props: { scope: MarketplaceScope; rows: SkillRows; noMatch: JSX.Element }) {
  const { t } = useText();
  const nav = () => props.scope.nav;
  const searching = () => nav().state.query.trim() !== "";
  const showYours = () => props.scope.model.agents().length > 0 && (props.rows.mine().length > 0 || !searching());
  return (
    <div class="marketplace-stack">
      <Show when={showYours()} fallback={props.noMatch}>
        <section class="marketplace-app-group" aria-labelledby="marketplace-skills-yours">
          <GroupHead
            id="marketplace-skills-yours"
            label={t("marketplace.skills.yours")}
            count={props.rows.mine().length}
            more={props.rows.mine().length > GROUP_LIMIT}
            onSeeAll={() => nav().go({ kind: "yourSkills" })}
          />
          <Show when={props.rows.mine().length > 0} fallback={<NoSkills />}>
            <OwnRows scope={props.scope} rows={props.rows} skills={props.rows.mine().slice(0, GROUP_LIMIT)} />
          </Show>
        </section>
      </Show>
    </div>
  );
}

function YoursList(props: { scope: MarketplaceScope; rows: SkillRows }) {
  const { t } = useText();
  const [page, setPage] = createStore({ shown: PAGE_SIZE });
  const sorted = () => props.rows.mine();
  return (
    <Show
      when={sorted().length > 0}
      fallback={
        <Text as="p" variant="body" tone="muted">
          {t("marketplace.noMatch.skills")}
        </Text>
      }
    >
      <section class="marketplace-skill-group-list" aria-label={t("marketplace.skills.yours")}>
        <OwnRows scope={props.scope} rows={props.rows} skills={sorted().slice(0, page.shown)} />
        <Show when={sorted().length > page.shown}>
          <Button
            type="button"
            variant="outline"
            class="marketplace-load-more"
            data-cuelume-tap="navigate"
            onClick={() =>
              setPage((draft) => {
                draft.shown += PAGE_SIZE;
              })
            }
          >
            {t("marketplace.loadMore")}
          </Button>
        </Show>
      </section>
    </Show>
  );
}

export function YourSkillsPage(props: { scope: MarketplaceScope }) {
  const { t } = useText();
  const nav = () => props.scope.nav;
  const label = () => t("marketplace.skills.yours");
  const rows = createSkillRows(props.scope);
  onSettled(() => props.scope.model.readSkills());

  return (
    <div class="marketplace-view marketplace-browse marketplace-skill-group-page">
      <header class="marketplace-skill-head-row">
        <div class="marketplace-browse-copy">
          <Heading as="h3" size="lg" class="marketplace-browse-title">
            {label()}
          </Heading>
          <Text as="p" variant="body" tone="muted">
            {t("marketplace.skills.count", { count: rows.mine().length })}
          </Text>
        </div>
      </header>
      <div class="marketplace-toolbar marketplace-skill-group-bar">
        <MarketplaceSearch nav={nav()} label={t("marketplace.skills.searchIn", { name: label() })} />
      </div>
      <YoursList scope={props.scope} rows={rows} />
    </div>
  );
}
